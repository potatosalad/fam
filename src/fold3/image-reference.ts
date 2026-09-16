import {InputError} from '../shared/input-error.js';
import type {Fold3Client} from './client.js';
import {WEB} from './http.js';
import {id} from './parse.js';

export function entryReference(value: string): {entryId: string; explicitType: boolean} {
  if (typeof value === 'string' && value.startsWith('https://')) {
    const url = new URL(value), match = url.pathname.match(/^\/sub-image\/(\d+)(?:\/|$)/);
    if (url.origin !== WEB || url.username || url.password || !match)
      throw new InputError('Expected the original Fold3 /sub-image/ URL for a SUB_IMAGE entry; INDEX_RECORD hits belong in fold3.record get.');
    return {entryId: id(match[1]), explicitType: true};
  }
  return {entryId: id(value), explicitType: false};
}

export function imageReference(image?: string, entry?: string): {imageId?: string; entryId?: string} {
  if (!!image === !!entry) throw new InputError('Supply exactly one of --image-id or --entry-id. SUB_IMAGE IDs belong in --entry-id.');
  if (entry) {
    const parsed=entryReference(entry);
    return {entryId:parsed.explicitType?`${WEB}/sub-image/${parsed.entryId}`:parsed.entryId};
  }
  if (image!.startsWith('https://')) {
    const url = new URL(image!);
    const match = url.pathname.match(/^\/(image|sub-image)\/(\d+)(?:\/|$)/);
    if (url.origin !== WEB || url.username || url.password || !match) throw new InputError('Expected a Fold3 image or sub-image URL.');
    return match[1] === 'sub-image' ? {entryId: `${WEB}/sub-image/${id(match[2])}`} : {imageId: id(match[2])};
  }
  return {imageId: id(image)};
}

export async function resolveImageReference(client: Fold3Client, reference: ReturnType<typeof imageReference>): Promise<string> {
  return reference.entryId ? (await client.entry(reference.entryId)).parentImageId : reference.imageId!;
}
