import type {CharacterProfile, Message, UserProfile} from '../types';
import {ContextBuilder} from './context';
import {formatActorRecentMessages} from './storyTheater';

/** Split existing context outputs; retrieval and all memory ownership rules remain with their callers. */
export async function buildStoryCharacterContextParts(input: {
    char: CharacterProfile; user: UserProfile; recalled: string; recent: Message[];
    identityName: string; header: string; skipWorldbookIds: Set<string>; realTime: boolean;
}): Promise<{stable: string; live: string}> {
    const {char, user, recalled, recent, identityName, header, skipWorldbookIds, realTime} = input;
    const actor = {...char, memoryPalaceInjection: recalled};
    const timeOptions = {skipTimeAwareness: !realTime || char.timeAwarenessEnabled === false};
    const stable = await ContextBuilder.buildCoreContext(actor, user, true, recalled, {
        skipUserProfile: true, skipWorldbookIds, headerOverride: header,
    }, timeOptions, {deferVolatile: true});
    const state = await ContextBuilder.buildVolatileCoreState(actor, {memoryPalaceContext: recalled, timeOptions});
    const carried = formatActorRecentMessages(char, recent, user.name, identityName, {
        includeTimestamps: realTime, preserveFullText: realTime,
    });
    const live = [state, carried].filter(text => text.trim()).join('\n');
    return {stable, live: live ? `${header}\n${live}` : ''};
}
