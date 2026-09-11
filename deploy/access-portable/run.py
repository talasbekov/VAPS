"""Host launcher for the offline access snapshot, Python stdlib only."""
import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = (HERE / 'access_transfer.py').read_text(encoding='utf-8')

WORKER = r'''
import sys

def saved_before_write(data):
    print(json.dumps({'backup': data}, cls=DjangoJSONEncoder), flush=True)
    if sys.stdin.readline().strip() != 'continue':
        raise ValueError('Хост не подтвердил сохранение резервного снимка. Запись отменена.')

try:
    if request['restore']:
        outcome = restore(request['data'], before_write=saved_before_write)
    else:
        outcome = transfer(request['data'], apply=request['apply'], before_write=saved_before_write)
    outcome.pop('backup', None)
    print(json.dumps({'result': outcome}, cls=DjangoJSONEncoder), flush=True)
except Exception as exc:
    print(json.dumps({'error': type(exc).__name__ + ': ' + str(exc)}), flush=True)
    raise SystemExit(1)
'''
LAUNCHER = "import json,sys; request=json.loads(sys.stdin.readline()); exec(compile(request['code'], 'access-transfer', 'exec'), {'request': request})"


def save_json(path, data):
    with path.open('x', encoding='utf-8') as file:
        os.chmod(path, 0o600)
        json.dump(data, file, ensure_ascii=False, indent=2)
        file.write('\n')
        file.flush()
        os.fsync(file.fileno())
    fsync_directory(path.parent)


def fsync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description='Индивидуальные права по логину, без подразделений. По умолчанию — проверка.')
    parser.add_argument('--data', type=Path, default=HERE/'roles.json')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--restore', type=Path, help='Явный откат прав по before.json этой же базы; требует --apply.')
    args = parser.parse_args()
    if args.restore and not args.apply:
        parser.error('--restore требует --apply')
    ctl = Path.cwd()/'ctl.sh'
    if not ctl.is_file():
        parser.error('Запустите из каталога Docker-комплекта, где находится ctl.sh.')
    source = args.restore or args.data
    data = json.loads(source.read_text(encoding='utf-8'))
    parent = Path.cwd()/'.access-transfer'
    parent.mkdir(mode=0o700, exist_ok=True)
    fsync_directory(parent.parent)
    folder = Path(tempfile.mkdtemp(prefix='run-', dir=parent))
    fsync_directory(parent)
    print('Отчёт текущего запуска:', folder, flush=True)
    request = {'code': SOURCE+'\n'+WORKER, 'data': data, 'apply': args.apply, 'restore': bool(args.restore)}
    outcome = None
    backed_up = False
    with (folder/'backend.log').open('x', encoding='utf-8') as log:
        proc = subprocess.Popen(['bash', str(ctl), 'exec', '-T', 'backend', 'python',
                                 'manage.py', 'shell', '-c', LAUNCHER],
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log,
                                text=True, encoding='utf-8', bufsize=1)
        try:
            proc.stdin.write(json.dumps(request)+'\n')
            proc.stdin.flush()
            for line in proc.stdout:
                try:
                    event = json.loads(line)
                except (ValueError, TypeError):
                    log.write(line)
                    continue
                if 'backup' in event:
                    if backed_up:
                        raise ValueError('Повторный резервный снимок в одном запуске.')
                    save_json(folder/'before.json', event['backup'])
                    backed_up = True
                    print('Резервный снимок сохранён. Применяю права…', flush=True)
                    proc.stdin.write('continue\n')
                    proc.stdin.flush()
                elif 'result' in event:
                    outcome = event['result']
                elif 'error' in event:
                    save_json(folder/'error.json', event)
            proc.stdin.close()
            code = proc.wait()
            if code or outcome is None or (args.apply and not outcome.get('applied')):
                print('Запуск не подтвердил успешное завершение. Ошибка/журнал:', folder, file=sys.stderr)
                return 1
            save_json(folder/'result.json', outcome)
        except BaseException:
            # EOF at acknowledgement rolls back; never send continue after failed fsync.
            proc.stdin.close()
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.terminate()
                proc.wait(timeout=15)
            print('Запуск прерван. Если запись уже началась, проверьте результат перед повтором. Отчёт:', folder, file=sys.stderr)
            raise
        finally:
            proc.stdout.close()
    if args.restore:
        print('ПРИМЕНЕНО: восстановлены права учёток:', outcome['restored'])
    else:
        print('ПРИМЕНЕНО.' if outcome['applied'] else 'ПРОВЕРКА: изменений в базе нет.')
        print('Совпало логинов:', outcome['matched'], '; изменено/будет изменено учёток:', outcome['changed_users'])
        print('Определения ролей:', outcome.get('changed_roles', 0), '; групп:', outcome.get('changed_groups', 0), '; прав:', outcome.get('changed_permissions', 0))
        print('Отсутствует на сервере:', len(outcome['missing_users']), '(список в result.json).')
        print('Роли индивидуальные; ограничений по подразделениям нет. Пароли сохранены.')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        print('ОШИБКА:', str(exc), file=sys.stderr)
        raise SystemExit(1)
