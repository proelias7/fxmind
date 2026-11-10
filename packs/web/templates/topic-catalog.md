# Catálogo de tópicos — Web (hints de busca)

Use ao rodar `/fxmind learn <topic>`. Tópicos livres também funcionam — infira paths a partir do pedido e de `reference.md`.

Aliases nos triggers ajudam o agente a reconhecer singular/plural e sinônimos (ex.: `pedido` aprendido → catálogo `pedidos` não vira órfão duplicado).

| Tópico | Triggers (palavras-chave) | Onde buscar (grep / paths) |
|--------|---------------------------|----------------------------|
| `auth` | auth, login, logout, sessão, session, token, jwt, oauth, permissão, role, middleware | `**/auth/**`, `middleware.*`, `**/guards/**`, `getServerSession`, `requireUser`, `@UseGuards` |
| `api` | api, endpoint, rota, route, handler, controller, server action, trpc, graphql | `app/api/**`, `pages/api/**`, `**/routes/**`, `**/controllers/**`, `"use server"`, `router.` |
| `database` | banco, database, schema, migration, migração, prisma, drizzle, sql, query, índice, index | `prisma/schema.prisma`, `**/migrations/**`, `drizzle.config.*`, `**/repositories/**`, `**/models/**` |
| `forms` | formulário, form, validação, validation, zod, yup, react-hook-form, input | `**/*Form*.*`, `useForm`, `z.object`, `schema.parse` |
| `ui` | componente, component, design system, tema, theme, tailwind, css, layout, modal | `components/**`, `**/ui/**`, `tailwind.config.*`, `globals.css` |
| `state` | estado, state, store, zustand, redux, pinia, react query, swr, cache client | `**/store/**`, `useQuery`, `createStore`, `defineStore`, `QueryClient` |
| `payments` | pagamento, payment, checkout, stripe, mercado pago, pix, assinatura, subscription, webhook | `**/payments/**`, `**/checkout/**`, `**/webhooks/**`, `stripe.` |
| `uploads` | upload, arquivo, file, imagem, image, storage, s3, bucket | `**/upload*`, `multer`, `formData`, `putObject`, `**/storage/**` |
| `jobs` | job, fila, queue, worker, cron, agendamento, background | `**/jobs/**`, `**/workers/**`, `bullmq`, `cron`, `queue.add` |
| `notifications` | email, e-mail, notificação, notification, sms, push, template | `**/emails/**`, `**/mail*`, `resend`, `nodemailer`, `sendEmail` |
| `i18n` | tradução, i18n, idioma, locale, translation | `**/locales/**`, `**/messages/**`, `useTranslation`, `next-intl` |
| `deploy` | deploy, ci, pipeline, docker, env, ambiente, vercel, build | `.github/workflows/**`, `Dockerfile`, `.env.example`, `vercel.json` |
| `testing` | teste, test, e2e, playwright, cypress, vitest, jest, fixture, mock | `**/*.test.*`, `**/*.spec.*`, `tests/**`, `e2e/**`, `playwright.config.*`, `vitest.config.*` |

## Slug livre

Exemplos: `learn checkout-flow`, `learn admin-dashboard`

- Normalizar slug: minúsculas, hífens, sem espaços
- Fatos atômicos: `fxmind_graph.addFact` (salvos em `.fxmind/memory/atoms.json`, compartilhados via git)
