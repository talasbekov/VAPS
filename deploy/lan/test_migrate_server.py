"""Safety boundaries for the standalone cold Smart migration operator."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


class MigrationTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name('migrate-server.py')
        self.assertTrue(path.is_file(), 'migration operator has not been implemented')
        spec = importlib.util.spec_from_file_location('server_move', path)
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)

    def test_address_rewrite_preserves_secrets_and_unrelated_settings(self):
        raw = ('BIND_IP=10.15.3.187\nNEXTAUTH_URL=http://10.15.3.187:3300\n'
               'ALLOWED_HOSTS=localhost,10.15.3.187\n'
               'POSTGRES_PASSWORD="literal-10.15.3.187-secret"\n'
               'DJANGO_SECRET_KEY=untouched\nTIME_ZONE=Asia/Almaty\n')
        value = self.m.rewrite_env(raw, '10.15.3.187', '10.15.3.251')
        self.assertIn('BIND_IP=10.15.3.251\n', value)
        self.assertIn('NEXTAUTH_URL=http://10.15.3.251:3300\n', value)
        self.assertIn('ALLOWED_HOSTS=localhost,10.15.3.251\n', value)
        self.assertIn('POSTGRES_PASSWORD="literal-10.15.3.187-secret"\n', value)
        self.assertIn('DJANGO_SECRET_KEY=untouched\nTIME_ZONE=Asia/Almaty\n', value)

    def test_source_binding_all_interfaces_is_changed_to_destination(self):
        value = self.m.rewrite_env('BIND_IP=0.0.0.0\n', '10.15.3.187', '10.15.3.251')
        self.assertEqual(value, 'BIND_IP=10.15.3.251\n')

    def test_archive_blocks_traversal_links_and_device_members(self):
        for name, kind in (('../database',tarfile.REGTYPE),('/etc/cron.d/x',tarfile.REGTYPE),
                           ('link',tarfile.SYMTYPE),('hard',tarfile.LNKTYPE),('device',tarfile.CHRTYPE)):
            with self.subTest(name=name):
                item=tarfile.TarInfo(name);item.type=kind
                with self.assertRaises(ValueError):self.m.check_member(item)

    def test_ordinary_cyrillic_paths_and_directories_are_valid(self):
        item=tarfile.TarInfo('./Документы/план.pdf');item.size=5
        self.m.check_member(item)
        item=tarfile.TarInfo('.');item.type=tarfile.DIRTYPE
        self.m.check_member(item)

    def test_runtime_image_must_match_export_or_exported_config_digest(self):
        expected={'source_id':'sha256:'+'1'*64,'config_id':'sha256:'+'2'*64}
        for value in expected.values():
            self.m.verify_image({'Id':value,'Os':'linux','Architecture':'amd64'},expected)
        with self.assertRaises(ValueError):
            self.m.verify_image({'Id':'sha256:'+'3'*64,'Os':'linux','Architecture':'amd64'},expected)
        with self.assertRaises(ValueError):
            self.m.verify_image({'Id':expected['config_id'],'Os':'linux','Architecture':'arm64'},expected)

    def test_classic_export_accepts_containerd_id_only_with_matching_actual_config(self):
        config='sha256:'+'1'*64
        expected={'source_id':config,'config_id':config}
        target={'Id':'sha256:'+'9'*64,'Os':'linux','Architecture':'amd64'}
        self.m.verify_image(target,expected,actual_config=config)
        with self.assertRaises(ValueError):
            self.m.verify_image(target,expected,actual_config='sha256:'+'2'*64)

    def test_stopped_or_running_foreign_volume_consumer_blocks_cold_export(self):
        own={'Id':'own','Mounts':[{'Type':'volume','Name':'smart_media'}]}
        for running in (False,True):
            foreign={'Id':'foreign','State':{'Running':running},'Mounts':[{'Type':'volume','Name':'smart_media'}]}
            with self.assertRaises(ValueError):self.m.require_exclusive_volumes([own,foreign],{'own'},{'smart_media'})
        self.m.require_exclusive_volumes([own,{'Id':'foreign','Mounts':[{'Type':'volume','Name':'dt_media'}]}],{'own'},{'smart_media'})

    def test_failed_export_resumes_only_before_archive_publication(self):
        for published in (False,True):
            with tempfile.TemporaryDirectory() as directory:
                stage=Path(directory);lock=stage/'lock';lock.mkdir()
                owner={'mode':'server-migration'};self.m.save(lock/'owner.json',owner)
                with patch.object(self.m,'resume_exact') as resume:
                    self.m.recover_export(Mock(),{},lock,stage,owner,True,False,published)
                    self.assertEqual(resume.call_count,0 if published else 1)
                    self.assertEqual(lock.exists(),published)

    def test_unclean_shutdown_always_keeps_source_fenced(self):
        with tempfile.TemporaryDirectory() as directory:
            stage=Path(directory);lock=stage/'lock';lock.mkdir()
            with patch.object(self.m,'resume_exact') as resume:
                self.m.recover_export(Mock(),{},lock,stage,{'mode':'server-migration'},True,True,False)
                resume.assert_not_called();self.assertTrue(lock.exists())

    def test_export_failures_after_checksum_or_final_evidence_keep_a_published_source_frozen(self):
        module=self.m
        class FakeDocker:
            def __init__(self,evidence):pass
            def run(self,command,stdout=None,**kwargs):
                if command[1]=='version':return b'linux/amd64'
                if command[1]=='save':
                    raw=b'{"architecture":"amd64","os":"linux"}'
                    tags=command[2:];name='config.json'
                    with tarfile.open(fileobj=stdout,mode='w') as archive:
                        for filename,data in ((name,raw),('manifest.json',json.dumps([{'Config':name,'RepoTags':tags}]).encode())):
                            entry=tarfile.TarInfo(filename);entry.size=len(data);archive.addfile(entry,io.BytesIO(data))
                    return b''
                if stdout is not None and '-czpf' in command:
                    with tarfile.open(fileobj=stdout,mode='w:gz'):pass
                    return b''
                return b'Database cluster state: shut down\n'
        for failure in ('checksum-published','final-evidence'):
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);stack=root/'stack';stack.mkdir();tools=root/'tools';tools.mkdir()
                for name in ('.env','images.env','docker-compose.yml'):(stack/name).write_text('test')
                (tools/'schema-transition-checks.py').write_text('"""Database evidence test"""')
                config={'name':'smart','services':{'backend':{'environment':{}}}}
                containers={'db':{'Id':'db'}};volumes={'postgres':'smart_postgres'}
                images={role:{'Id':'sha256:'+str(index)*64,'Size':0} for index,role in enumerate(('backend','frontend','proxy','db','redis'),1)}
                original_save=module.save
                def fail_save(path,value):
                    if ((failure=='checksum-published' and Path(path).name=='owner.json' and value.get('phase')=='source-frozen')
                            or (failure=='final-evidence' and Path(path).name=='SOURCE-FROZEN.json')):
                        raise OSError('injected final evidence failure')
                    return original_save(path,value)
                args=SimpleNamespace(stack=stack,out=root/'full.tar.gz',tools=tools,source_ip='10.15.3.187')
                with patch.object(module,'Docker',FakeDocker),patch.object(module,'inventory',return_value=(config,containers,volumes,images)),\
                     patch.object(module,'maintenance_inventory',return_value={}),patch.object(module,'estimate_volume_bytes',return_value=0),\
                     patch.object(module,'probe',return_value={'exact':'snapshot'}),patch.object(module,'stop_exact'),\
                     patch.object(module,'exclusive_volumes'),patch.object(module,'copied_database_proof'),\
                     patch.object(module,'save',side_effect=fail_save),patch.object(module,'resume_exact') as resume:
                    with self.assertRaises(OSError):module.export_source(args)
                    resume.assert_not_called()
                self.assertTrue(args.out.exists());self.assertTrue(Path(str(args.out)+'.sha256').exists())
                owner=json.loads((stack/'.offline-update-lock/owner.json').read_text())
                self.assertTrue(owner['snapshot_published'])

    def test_existing_launcher_gets_an_idempotent_migration_fence(self):
        raw='#!/usr/bin/env bash\nset -euo pipefail\nexec docker compose "$@"\n'
        guarded=self.m.guarded_ctl(raw)
        self.assertIn('.offline-update-lock/owner.json',guarded)
        self.assertIn('server-migration',guarded)
        self.assertEqual(self.m.guarded_ctl(guarded),guarded)
        self.assertIn('exec docker compose "$@"',guarded)

    def test_compose217_missing_network_is_optional_but_permission_error_is_not(self):
        self.assertTrue(self.m.missing_object(b'Error response from daemon: network smart_default not found'))
        self.assertTrue(self.m.missing_object(b'Error: No such image: missing'))
        self.assertFalse(self.m.missing_object(b'permission denied while connecting to daemon'))

    def test_shared_or_bound_storage_is_not_silently_included(self):
        good={'Type':'volume','Name':'smart_postgres','Destination':'/var/lib/postgresql/data'}
        volumes={'smart_postgres':{'Labels':{'com.docker.compose.project':'smart','com.docker.compose.volume':'postgres'},'Driver':'local','Options':{}}}
        self.assertEqual(self.m.validate_mounts('smart',[good],volumes),{'postgres':'smart_postgres'})
        bad=dict(good,Type='bind',Source='/home/user/new')
        with self.assertRaises(ValueError):self.m.validate_mounts('smart',[bad],volumes)
        volumes['smart_postgres']['Labels']['com.docker.compose.project']='dt'
        with self.assertRaises(ValueError):self.m.validate_mounts('smart',[good],volumes)

    def test_no_restore_into_preexisting_target_resources(self):
        for resources in ({'containers':['a']},{'volumes':['v']},{'networks':['n']}):
            with self.subTest(resources=resources):
                with self.assertRaises(ValueError):self.m.require_empty_resources(resources)
        self.m.require_empty_resources({'containers':[],'volumes':[],'networks':[]})

    def test_checksum_rejects_a_truncated_volume_before_restore(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'volume.tar.gz').write_bytes(b'truncated')
            manifest={'files':{'volume.tar.gz':hashlib.sha256(b'complete').hexdigest()}}
            with self.assertRaises(ValueError):self.m.verify_files(root,manifest)

    def test_unrelated_backend_settings_are_preserved_when_comparing_configs(self):
        source={'name':'old','services':{'backend':{'image':'old-image','environment':{
            'POSTGRES_PASSWORD':'same','ALLOWED_HOSTS':'10.15.3.187','TIME_ZONE':'Asia/Almaty'}}},
            'volumes':{'postgres':{'name':'old_postgres'}},'networks':{'default':{'name':'old_default','internal':True}}}
        target=json.loads(json.dumps(source));target['name']='new'
        target['services']['backend']['image']='new-image'
        target['services']['backend']['environment']['ALLOWED_HOSTS']='10.15.3.251'
        target['volumes']['postgres']['name']='new_postgres';target['networks']['default']['name']='new_default'
        self.m.compare_configs(source,target,'10.15.3.187','10.15.3.251')
        target['services']['backend']['environment']['POSTGRES_PASSWORD']='lost'
        with self.assertRaises(ValueError):self.m.compare_configs(source,target,'10.15.3.187','10.15.3.251')

    def test_compose217_and_newer_explicit_defaults_are_semantically_equal(self):
        source={'services':{'backend':{'depends_on':{'db':{'condition':'service_healthy'}}}},
                'volumes':{'postgres':{'external':False}},'networks':{'default':{'external':False,'internal':True}}}
        target=json.loads(json.dumps(source))
        target['services']['backend']['depends_on']['db']['required']=True
        target['volumes']['postgres'].pop('external');target['networks']['default'].pop('external')
        self.m.compare_configs(source,target,'10.15.3.187','10.15.3.251')
        self.assertNotIn('required',source['services']['backend']['depends_on']['db'])

    def test_resolved_yaml_extension_templates_do_not_block_address_and_image_changes(self):
        source={'x-backend-env':{'ALLOWED_HOSTS':'10.15.3.187','POSTGRES_PASSWORD':'unchanged'},
                'x-backend':{'image':'original-backend','environment':{'CORS_ALLOWED_ORIGINS':'http://10.15.3.187:3300'}},
                'x-logging':{'driver':'json-file'},
                'services':{'backend':{'image':'original-backend','environment':{
                    'ALLOWED_HOSTS':'10.15.3.187','CORS_ALLOWED_ORIGINS':'http://10.15.3.187:3300','POSTGRES_PASSWORD':'unchanged'}}}}
        target=json.loads(json.dumps(source))
        target['x-backend-env']['ALLOWED_HOSTS']='10.15.3.251'
        target['x-backend']['image']='transferred-backend'
        target['x-backend']['environment']['CORS_ALLOWED_ORIGINS']='http://10.15.3.251:3300'
        target['x-extra-template']={'metadata':'not a running service'}
        target['services']['backend']['image']='transferred-backend'
        target['services']['backend']['environment'].update(ALLOWED_HOSTS='10.15.3.251',CORS_ALLOWED_ORIGINS='http://10.15.3.251:3300')
        self.m.compare_configs(source,target,'10.15.3.187','10.15.3.251')
        self.assertIn('x-backend',source)
        target['services']['backend']['environment']['POSTGRES_PASSWORD']='changed'
        with self.assertRaises(ValueError):self.m.compare_configs(source,target,'10.15.3.187','10.15.3.251')

    def test_x_prefix_in_real_service_names_environment_labels_or_volumes_remains_checked(self):
        source={'services':{'x-real-service':{'environment':{'x-real-setting':'same'},'labels':{'x-real-label':'same'}}},
                'volumes':{'x-real-volume':{'driver':'local'}}}
        for kind in ('service','environment','label','volume'):
            target=json.loads(json.dumps(source))
            if kind=='service':target['services'].pop('x-real-service')
            if kind=='environment':target['services']['x-real-service']['environment']['x-real-setting']='changed'
            if kind=='label':target['services']['x-real-service']['labels']['x-real-label']='changed'
            if kind=='volume':target['volumes']['x-real-volume']['driver']='other'
            with self.subTest(kind=kind),self.assertRaises(ValueError):
                self.m.compare_configs(source,target,'10.15.3.187','10.15.3.251')

    def test_real_dependency_storage_network_and_restart_changes_still_refuse(self):
        source={'services':{'backend':{'depends_on':{'db':{'condition':'service_healthy'}},'restart':'unless-stopped'}},
                'volumes':{'postgres':{'external':False}},'networks':{'default':{'external':False,'internal':True}}}
        for change in ('dependency','storage','network','restart'):
            target=json.loads(json.dumps(source))
            if change=='dependency':target['services']['backend']['depends_on']['db']['required']=False
            if change=='storage':target['volumes']['postgres']['external']=True
            if change=='network':target['networks']['default']['internal']=False
            if change=='restart':target['services']['backend']['restart']='always'
            with self.subTest(change=change),self.assertRaises(ValueError):
                self.m.compare_configs(source,target,'10.15.3.187','10.15.3.251')

    def test_config_difference_reports_paths_without_secret_values(self):
        source={'services':{'backend':{'environment':{'POSTGRES_PASSWORD':'private-source-secret'}}}}
        target={'services':{'backend':{'environment':{'POSTGRES_PASSWORD':'private-target-secret'}}}}
        with self.assertRaises(ValueError) as error:self.m.compare_configs(source,target,'10.15.3.187','10.15.3.251')
        message=str(error.exception)
        self.assertIn('services.backend.environment.POSTGRES_PASSWORD',message)
        self.assertNotIn('private-source-secret',message);self.assertNotIn('private-target-secret',message)

    def test_preflight_retry_requires_same_snapshot_and_zero_created_resources(self):
        state={'phase':'recovery-required','bundle_sha256':'same','migration_id':'id','project':'smart','activation_attempted':False}
        empty={'containers':[],'volumes':[],'networks':[]}
        self.m.require_preflight_retry(state,'same','id','smart',empty)
        for key,value in (('bundle_sha256','other'),('migration_id','other'),('project','twin'),
                          ('activation_attempted',True),('phase','restoring-volumes'),('volumes',{'postgres':'created'}),
                          ('resource_creation_started',True)):
            changed={**state,key:value}
            with self.subTest(key=key),self.assertRaises(ValueError):self.m.require_preflight_retry(changed,'same','id','smart',empty)
        for kind in empty:
            with self.subTest(kind=kind),self.assertRaises(ValueError):
                self.m.require_preflight_retry(state,'same','id','smart',{**empty,kind:['preexisting']})

    def test_preflight_retry_preserves_manual_configuration_edits(self):
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'.env';file.write_bytes(b'POSTGRES_PASSWORD=manually-edited\n')
            with self.assertRaises(ValueError):self.m.configuration_file(file,'POSTGRES_PASSWORD=original\n',retry=True)
            self.assertEqual(file.read_text(),'POSTGRES_PASSWORD=manually-edited\n')
            self.m.configuration_file(file,'POSTGRES_PASSWORD=manually-edited\n',retry=True)

    def test_rejected_retry_never_erases_prior_activation_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);bundle=root/'snapshot.tar.gz';bundle.write_bytes(b'snapshot')
            checksum=self.m.digest(bundle);Path(str(bundle)+'.sha256').write_text(checksum+'  '+bundle.name)
            target=root/'target';target.mkdir();path=target/'.server-move-state.json'
            state={'phase':'recovery-required','activation_attempted':True,'migration_id':'id','project':'smart','bundle_sha256':checksum}
            self.m.save(path,state);before=path.read_bytes()
            args=SimpleNamespace(bundle=bundle,target=target,resume_preflight=True,owner=None)
            with self.assertRaises(ValueError):self.m.import_target_locked(args)
            self.assertEqual(path.read_bytes(),before)

    def test_retry_cannot_trust_a_rewritten_cached_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);payload=root/'cache';payload.mkdir();bundle=root/'snapshot.tar.gz'
            original=json.dumps({'format':'original','files':{'data':self.m.digest(__file__)}}).encode()
            with tarfile.open(bundle,'w:gz') as archive:
                item=tarfile.TarInfo('manifest.json');item.size=len(original);archive.addfile(item,io.BytesIO(original))
            (payload/'manifest.json').write_bytes(original);(payload/'data').write_bytes(b'data')
            self.assertEqual(self.m.original_cached_manifest(bundle,payload)['format'],'original')
            changed=json.loads(original);changed['format']='rewritten';changed['files']['data']=hashlib.sha256(b'changed').hexdigest()
            (payload/'manifest.json').write_text(json.dumps(changed));(payload/'data').write_bytes(b'changed')
            with self.assertRaises(ValueError):self.m.original_cached_manifest(bundle,payload)
            (payload/'manifest.json').write_bytes(original);(payload/'extra').write_bytes(b'extra')
            with self.assertRaises(ValueError):self.m.original_cached_manifest(bundle,payload)

    def test_same_completed_migration_is_replay_without_data_restoration(self):
        state={'migration_id':'same','phase':'complete'}
        self.assertTrue(self.m.completed_replay(state,'same'))
        with self.assertRaises(ValueError):self.m.completed_replay(state,'other')
        with self.assertRaises(ValueError):self.m.completed_replay({'migration_id':'same','phase':'restoring'},'same')

    def test_rejected_destination_never_stops_a_preexisting_service(self):
        info={'Config':{'Labels':{'com.docker.compose.project':'smart','com.docker.compose.service':'frontend',
            'com.docker.compose.project.working_dir':'/existing'}}}
        self.assertFalse(self.m.owned_target_service(info,'smart',Path('/new'),False))
        self.assertFalse(self.m.owned_target_service(info,'smart',Path('/new'),True))
        self.assertTrue(self.m.owned_target_service(info,'smart',Path('/existing'),True))

    def test_runtime_archive_cannot_retag_an_unrelated_application(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'images.tar'
            raw=json.dumps({'architecture':'amd64','os':'linux'}).encode()
            config_id=hashlib.sha256(raw).hexdigest()
            tag='smart-josparlau/server-move-'+'a'*32+':backend'
            expected={'backend':{'tag':tag,'config_id':'sha256:'+config_id}}
            for extra in (False,True):
                image_manifest=[{'Config':config_id+'.json','RepoTags':[tag]+(['digital-twin:current'] if extra else [])}]
                with tarfile.open(path,'w') as archive:
                    for name,data in ((config_id+'.json',raw),('manifest.json',json.dumps(image_manifest).encode())):
                        entry=tarfile.TarInfo(name);entry.size=len(data);archive.addfile(entry,io.BytesIO(data))
                if extra:
                    with self.assertRaises(ValueError):self.m.verify_runtime_archive(path,expected)
                else:self.m.verify_runtime_archive(path,expected)


if __name__=='__main__':
    unittest.main()
