import {parseJson} from '../shared/json.js';

export type SearchFieldValue = string | number | boolean | Record<string, string | number | boolean>;
export interface SearchField {name: string; type: string; label: string; config: Record<string, any>;}
export function collectionSearchFields(collection: Record<string, any>): SearchField[] {
  const decode = (value: unknown): Record<string, any> => typeof value === 'string' ? parseJson(value) as Record<string, any> : value as Record<string, any> ?? {};
  const configs = {...decode(collection.formConfig?.simpleComponents), ...decode(collection.formConfig?.advancedComponents),
    ...decode(collection.formComponents?.components), ...decode(collection.formComponents?.advancedComponents)};
  return Object.entries(configs).map(([key, config]) => ({name: config.name ?? key, type: config.type,
    label: String(config.label ?? key).split('||').at(-1)!, config}));
}
const scalarProperties: Record<string, string> = {Age:'age', Country:'c', Custom:'v', CustomCheckbox:'v', HasPhotos:'hp', Keyword:'kw', Language:'ln'};
const objectProperties: Record<string, Record<string, string>> = {
  Name:{firstName:'fn',lastName:'ln',gender:'g',firstNameMode:'fnmo',lastNameMode:'lnmo'},
  Event:{type:'et',year:'ey',month:'em',day:'ed',place:'ep',exactYear:'me',yearRange:'mer',placeMatch:'epmo'},
  MediaType:{photos:'p',documents:'d',videos:'v',audios:'a'}, PhoneNumber:{areaCode:'ac',phoneNumber:'pn'},
};
/** Same scalar property names and component encoding as SearchFormComponentsConverter. */
export function encodeCollectionFields(fields: Record<string, SearchFieldValue>, available: SearchField[], escape: (value: string | number | boolean) => string) {
  return Object.entries(fields).map(([name, value]) => {
    const field = available.find(f => f.name === name); if (!field) throw new Error(`Unknown collection field ${name}; use fam myheritage search-fields COLLECTION.`);
    let properties: Record<string, string | number | boolean>;
    const property = scalarProperties[field.type];
    if (property) {
      if (!['string','number','boolean'].includes(typeof value)) throw new Error(`${name} requires a string, number or boolean.`);
      properties = {[property]: value as string | number | boolean};
    } else {
      const mapping = objectProperties[field.type];
      if (!mapping || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} (${field.type}) requires a structured value. Use events/relatives options for lists.`);
      properties = field.type === 'Event' ? {et: field.config.defaultType ?? name} : {};
      for (const [key, item] of Object.entries(value)) {
        if (!mapping[key] || !['string','number','boolean'].includes(typeof item)) throw new Error(`Unsupported ${name} property ${key}; expected ${Object.keys(mapping).join(', ')}.`);
        properties[mapping[key]!] = item;
      }
    }
    for (const item of Object.values(properties)) if (String(item).length > 1000 || /[\x00-\x1f\\]/.test(String(item)) || typeof item === 'number' && !Number.isFinite(item)) throw new Error(`Invalid collection field ${name}.`);
    return {key: `q${escape(name)}`, value: [field.type,...Object.entries(properties).map(([key,value])=>`${key}.${escape(value)}`)].join(' ')};
  });
}
