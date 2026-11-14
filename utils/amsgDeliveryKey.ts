/** Stable identity across push, outbox and a replay of the same task occurrence. */
export function amsgDeliveryKey(m:{taskUuid?:unknown;occurrenceMs?:unknown;metadata?:any}):string|null{
 const meta=m.metadata,uuid=m.taskUuid??meta?.activeMsg2?.taskUuid,at=meta?.amsgOccurrenceMs??m.occurrenceMs,index=Number(meta?.messageIndex);
 return typeof uuid==='string'&&uuid&&typeof at==='number'&&Number.isFinite(at)&&Number.isInteger(index)&&index>0?`${uuid}@${at}#${index}`:null;
}
