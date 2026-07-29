import type { WorkspaceFile } from "./workspace-types";

export const files: readonly WorkspaceFile[] = [
  { id: "proposal", name: "proposal.md", icon: "◇" },
  { id: "design", name: "design.md", icon: "◇" },
  { id: "tasks", name: "tasks.md", icon: "◇" },
];

export const initialMarkdown = `# Добавить SSO-аутентификацию

## Зачем

Сейчас пользователи входят по локальному логину и паролю. Корпоративным клиентам нужен единый вход через существующий identity provider.

## Что изменится

- Добавить вход через OIDC-провайдера
- Связывать корпоративную учётную запись с локальным профилем
- Сохранять текущий способ входа для существующих пользователей

## Возможности

### Новые возможности

- \`sso-authentication\`: вход через корпоративный OIDC
- \`account-linking\`: безопасная привязка учётных записей

## Влияние

- API: новые endpoints \`/auth/sso/*\`
- Данные: таблица внешних identity
- Безопасность: проверка state, nonce и PKCE
`;
