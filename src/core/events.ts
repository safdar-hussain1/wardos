export type EventAction =
  | 'PATIENT_REGISTERED'
  | 'ADMITTED'
  | 'TRANSFERRED'
  | 'CHARGE_ADDED'
  | 'DEPOSIT_RECORDED'
  | 'DISCHARGED'
  | 'AMBULANCE_DISPATCHED'
  | 'AMBULANCE_RETURNED'
  | 'USER_CREATED'
  | 'STAFF_ADDED'

export interface EventRow {
  id: number
  at: string
  actorUserId: number | null
  action: EventAction
  entity: string
  entityId: number | null
  payload: string
}
