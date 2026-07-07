// Вход (Д1): страница /login с двумя взаимоисключающими способами —
// идентификатор (X-User-Id, dev + пилот-fallback A6) и вставка готового JWT
// (внешний Auth INT-2, redirect-flow контракта не имеет). Первая форма
// проекта: RHF (uncontrolled) + zod (канон L246). Headless без стилей (8.7).
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useLocation, useNavigate } from 'react-router'
import { z } from 'zod'
import { useAuth } from '../../shared/auth/AuthContext'
import type { Credential } from '../../shared/auth/credential'
import { ROUTES } from '../../shared/routes'

export const EXACTLY_ONE_MESSAGE =
  'Заполните ровно одно поле: идентификатор ИЛИ JWT-токен'

const loginSchema = z
  .object({
    userId: z.string().trim(),
    jwt: z.string().trim(),
  })
  // «ровно одно заполнено»: пусто-пусто и оба — блок сабмита (AC 2)
  .refine((values) => (values.userId !== '') !== (values.jwt !== ''), {
    message: EXACTLY_ONE_MESSAGE,
    path: ['userId'],
  })

type LoginFormValues = z.infer<typeof loginSchema>

/**
 * location.state в react-router фактически нетипизирован (Ловушка 12):
 * обращаемся как с unknown и наррowим до безопасного To-пути.
 */
function fromLocationState(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null
  const from: unknown = (state as Record<string, unknown>).from
  if (typeof from !== 'object' || from === null) return null
  const pathname: unknown = (from as Record<string, unknown>).pathname
  // '//host' — protocol-relative URL: pushState на кросс-origin кидает
  // SecurityError; принимаем только внутренние пути ('/…', но не '//…')
  if (
    typeof pathname !== 'string' ||
    !pathname.startsWith('/') ||
    pathname.startsWith('//')
  ) {
    return null
  }
  const search = (from as Record<string, unknown>).search
  const hash = (from as Record<string, unknown>).hash
  return (
    pathname +
    (typeof search === 'string' ? search : '') +
    (typeof hash === 'string' ? hash : '')
  )
}

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { userId: '', jwt: '' },
  })

  const onSubmit = handleSubmit((values) => {
    const credential: Credential =
      values.jwt !== ''
        ? { kind: 'jwt', token: values.jwt }
        : { kind: 'dev', userId: values.userId }
    login(credential)
    // возврат на исходно запрошенный маршрут (state.from) или домой (AC 1)
    navigate(fromLocationState(location.state) ?? ROUTES.home, {
      replace: true,
    })
  })

  return (
    <main>
      <h1>Вход</h1>
      {/* нативный form: Enter в любом поле сабмитит (keyboard path L262) */}
      <form onSubmit={(event) => void onSubmit(event)}>
        <label>
          Идентификатор (X-User-Id)
          <input type="text" autoComplete="off" {...register('userId')} />
        </label>
        <label>
          JWT-токен
          <input type="text" autoComplete="off" {...register('jwt')} />
        </label>
        {errors.userId && <p role="alert">{errors.userId.message}</p>}
        <button type="submit">Войти</button>
      </form>
    </main>
  )
}
