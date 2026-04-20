# Текущий TODO по локальному брокеру

## Уже закрыто

- [x] убрать `reveal` из CLI и документации
- [x] перестать трогать `defaultProfile` без явного `--set-default`
- [x] добавить `allowedCommands` в policy
- [x] предупреждать о shell/interpreter-командах в `policy add`
- [x] проверять `allowedCommands` до fetch секрета
- [x] писать audit-записи на failure-path
- [x] вернуть Unix-конвенцию `128 + signal`
- [x] переписать `doctor`
- [x] переписать README / SPEC / SECURITY под локальный сценарий

## Следующий этап

### 1. Реальный approval flow

- [ ] `requiresApproval` должен перестать быть metadata-only
- [ ] approval только для локального интерактивного использования
- [ ] никакого специального CI-bypass режима
- [ ] audit должен фиксировать granted / denied / cached

### 2. Usage controls

- [ ] `maxUsesPerHour` per alias
- [ ] `cooldownSeconds` per alias
- [ ] state-файл usage с `0600`

### 3. Дополнительное ужесточение

- [ ] решить, нужна ли редакция child output
- [ ] при необходимости добавить отдельный warning/doctor-check для alias без `allowedCommands`
- [ ] рассмотреть отдельный state-файл approval cache с TTL

## Не включать в roadmap

- [ ] CI-orchestration
- [ ] remote service mode
- [ ] shared daemon
- [ ] direct secret reveal
