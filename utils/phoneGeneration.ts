import type { CharacterProfile, PhoneContact, PhoneEvidence } from '../types';

/** UI mirrors a successful commit; never writes a second stale character snapshot. */
export const PHONE_GENERATION_COMMITTED = 'phone-generation-committed';

export interface PhoneGeneration {
    records: PhoneEvidence[];
    contacts?: PhoneContact[];
    baseContacts?: PhoneContact[];
}

/**
 * Apply only the returned batch to the latest persisted/in-memory state.
 * Existing phone records, handwritten notes, NPC topic boxes and unrelated
 * simulation logs always take precedence over an old generation snapshot.
 */
export function mergePhoneGeneration(
    current: CharacterProfile['phoneState'],
    generation: PhoneGeneration,
): NonNullable<CharacterProfile['phoneState']> {
    const contacts = [...(current?.contacts || [])];
    const aliases = new Map<string, string | undefined>();
    for (const incoming of generation.contacts || []) {
        const base = generation.baseContacts?.find(contact => contact.id === incoming.id);
        if (base && JSON.stringify(base) === JSON.stringify(incoming)) continue;
        const index = contacts.findIndex(contact => contact.id === incoming.id
            || (incoming.linkedCharId
                ? contact.linkedCharId === incoming.linkedCharId
                : contact.name.trim().toLowerCase() === incoming.name.trim().toLowerCase()));
        if (index < 0) {
            // Never resurrect a contact explicitly deleted after generation began.
            if (base) { aliases.set(incoming.id, undefined); continue; }
            contacts.push(incoming);
            continue;
        }
        const latest = contacts[index];
        aliases.set(incoming.id, latest.id);
        const merged = { ...latest };
        for (const key of Object.keys(incoming) as (keyof PhoneContact)[]) {
            if (key === 'id') continue;
            if (base ? JSON.stringify(latest[key]) === JSON.stringify(base[key]) : latest[key] === undefined) {
                (merged as any)[key] = incoming[key];
            }
        }
        if (latest.note) merged.note = latest.note;
        if (latest.identityManual) {
            merged.identity = latest.identity;
            merged.identityManual = latest.identityManual;
        }
        contacts[index] = merged;
    }
    const seen = new Set((current?.records || []).map(record => record.id));
    const records = generation.records
        .filter(record => {
            if (seen.has(record.id)) return false;
            seen.add(record.id);
            return true;
        })
        .map(record => record.contactId && aliases.has(record.contactId)
            ? { ...record, contactId: aliases.get(record.contactId) } : record);
    return { ...current, records: [...(current?.records || []), ...records], ...(generation.contacts ? { contacts } : {}) };
}

export const PHONE_CONVERSATION_COMMITTED = 'phone-conversation-committed';

export interface PhoneConversationChange {
    charId: string;
    record: PhoneEvidence;
    contact: PhoneContact;
    card?: { content: string; detail: string };
    broadcast?: string;
}

export function mergePhoneConversation(
    current: CharacterProfile['phoneState'], change: PhoneConversationChange,
): NonNullable<CharacterProfile['phoneState']> {
    const upsert = <T extends { id: string }>(items: T[] | undefined, next: T) => {
        const previous = items || [];
        return previous.some(item => item.id === next.id)
            ? previous.map(item => item.id === next.id ? next : item)
            : [...previous, next];
    };
    return { ...current, records: upsert(current?.records, change.record),
        contacts: upsert(current?.contacts, change.contact) };
}
