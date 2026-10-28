type DispatchState = {tab: string; people: number; waiting: number; active: number; invalid: number; history: number; hasFilters: boolean};
type EmptyState = {kind: string; title: string; detail: string; action?: 'assigned' | 'waiting' | 'roster' | 'clear'};
export function showDispatchFilters(total: number, hasFilters: boolean): boolean { return total > 0 || hasFilters; }
export function dispatchEmptyState(state: DispatchState): EmptyState {
  if (state.hasFilters) return {kind:'filtered', title:'По этим условиям сотрудников нет', detail:'Измените условия поиска или сбросьте фильтры.', action:'clear'};
  if (state.tab === 'history') return {kind:'no-history', title:'Снятых назначений за этот день нет', detail:'Здесь появятся назначения после снятия с указанием причины.'};
  if (state.tab === 'assigned') return {kind:'no-assignments', title:'Почасовые смены ещё не назначены', detail:state.waiting > 0 ? 'Выберите сотрудника из ожидающих и укажите место и время смены.' : 'Назначения через статусы доступны в общем составе дежурства.', action:state.waiting > 0 ? 'waiting' : state.people > 0 ? 'roster' : undefined};
  if (state.invalid > 0) return {kind:'attention', title:'Есть назначения, требующие проверки', detail:'Выделение сотрудников изменилось. Проверьте прежние назначения перед продолжением.', action:'assigned'};
  if (state.people > 0 || state.active > 0) return {kind:'placed', title:'Все выделенные сотрудники расставлены', detail:'Новых сотрудников, ожидающих назначения, нет.', action:state.active > 0 ? 'assigned' : 'roster'};
  return {kind:'unallocated', title:'На эту дату сотрудники ещё не выделены', detail:'Проверьте дату. После выделения сотрудников подразделениями здесь можно будет назначить место и время смены.'};
}

