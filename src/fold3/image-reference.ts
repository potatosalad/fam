import {InputError} from '../shared/input-error.js';
import type {Fold3Client} from './client.js';
import {WEB} from './http.js';
import {id} from './parse.js';

export function imageReference(image?: string, entry?: string): {imageId?: string; entryId?: string} {
  if (!!image === !!entry) throw new InputError('Supply exactly one of --image-id or --entry-id. SUB_IMAGE IDs belong in --entry-id.');
  if (entry) return {entryId: id(entry)};
  if (image!.startsWith('https://')) {
    const url = new URL(image!);
    const match = url.pathname.match(/^\/(image|sub-image)\/(\d+)(?:\/|$)/);
    if (url.origin !== WEB || url.username || url.password || !match) throw new InputError('Expected a Fold3 image or sub-image URL.');
    return match[1] === 'sub-image' ? {entryId: id(match[2])} : {imageId: id(match[2])};
  }
  return {imageId: id(image)};
}

export async function resolveImageReference(client: Fold3Client, reference: ReturnType<typeof imageReference>): Promise<string> {
  return reference.entryId ? (await client.entry(reference.entryId)).parentImageId : reference.imageId!;
}
