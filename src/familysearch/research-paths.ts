// Only read services observed in the FamilySearch website. These do not extend
// the genealogy client's write surface or accept arbitrary credential destinations.
export function isResearchPath(path: string): boolean {
  return /^\/ark:\/61903\/3:[12]:[A-Z0-9-]+(?:\/(?:image\.xml|dist\.jpg))?$/i.test(path)
    || /^\/service\/cds\/recapi\/(?:collections\/\d+(?:\/waypoints)?|waypoints\/[A-Z0-9:,-]+)$/i.test(path)
    || /^\/service\/records\/storage\/(?:dascloud\/das\/v2|deepzoomcloud\/dz\/v1)\/(?:TH-[A-Z0-9-]+|3:[12]:[A-Z0-9-]+)(?:\/(?:parents|children|permission|name|image\.xml|dist\.jpg|artifactmetadata\.xml))?$/i.test(path)
    || /^\/service\/search\/fulltext\/(?:search(?:\/groupNumber)?|collections)$/.test(path)
    || isTranscriptPath(path)
    || /^\/search\/filmdatainfo\/(?:image-data|film-data|waypoint-data)$/.test(path);
}
export function isTranscriptPath(path: string): boolean {
  return /^\/service\/records\/volunteer\/orchestration\/sls\/image\/records\/3:[12]:[A-Z0-9-]+$/i.test(path);
}
