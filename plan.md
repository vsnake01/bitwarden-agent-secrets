# Локальный план развития `bitwarden-agent-secrets`

## Позиционирование

Проект остаётся локальным CLI-брокером для одной машины и одного пользователя. Он не развивается в сторону CI, удалённого сервиса или shared-daemon модели.

## Что уже должно считаться базовым уровнем зрелости

- честная документация без несуществующих security-гарантий
- явная threat model
- строгий локальный allowlist по alias и profile
- дополнительное ограничение `allowedCommands`
- полноценный `doctor` с проверкой прав, профиля, credential store и Bitwarden-доступности
- audit на success и failure-path
- отсутствие команды `reveal`

## Статус текущего прохода

Сделано:

1. `init` больше не перезаписывает `defaultProfile` без `--set-default`
2. `doctor` переписан и умеет текстовый и JSON-режим
3. `policy add` поддерживает `--allowed-command`
4. runtime-команды реально проверяют `allowedCommands`
5. audit пишет записи для `policy_violation` и `fetch_error`
6. signal exit code приведён к `128 + signal`
7. `reveal` удалён из CLI и из схемы policy
8. README, SPEC и SECURITY выровнены под модель локального брокера

## Следующие локальные приоритеты

1. Реализовать настоящий `requiresApproval` без какого-либо CI-режима обхода
2. Добавить rate-limit / cooldown per alias
3. Решить, нужна ли редакция child stderr/stdout или достаточно честно документировать риск
4. При необходимости вынести state-файлы approval/usage в отдельную подсистему с блокировкой записи

## Чего не делать

- не строить CI-first сценарии
- не добавлять `reveal` обратно
- не изображать `allowedCommands` как sandbox
- не обещать защиту от злонамеренной дочерней команды
