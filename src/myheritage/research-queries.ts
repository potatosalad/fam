/** Documents from the public SuperSearchMainForm and CollectionCatalog bundles.
 * search_query_upload is the website's search operation; it does not edit a tree.
 * See docs/myheritage/research.md for source versions and access behavior. */
export function historicalRecordsQuery(lang: string, limit: number, after = 'undefined'): string {
  return `mutation do_search($query: EditableQuery_!) {
 search_query_upload(id: "search-0", lang: ${JSON.stringify(lang)}, upload_data: $query) {
  response {
   summary {
  category_counts {
    ... categoryFields
  }
  total {
    ... categoryFields
  }
}
   results(first: ${limit}, after: ${JSON.stringify(after)}) {
    count
    data {
     record_type
     user_info {is_new is_purchased link}
     record {... recordFields}
     cursor
    }
   }
  }
 }
}

fragment categoryFields on QueryResponseSummaryCategory {
  category_name
  count
  link
}

fragment recordFields on RecordBase {
    id
    name
    translated_name
    name_annotations
    thumbnail {
      url
    }
    fallback_thumbnail {
      url
    }
    link
    is_free
    collection {
      ... COLLECTION
    }
    related_photos {
      photo_id
    }
    hidden_fields {
      ... FIELD
    }
    display_fields {
      ... FIELD
    }
}

fragment COLLECTION on Collection {
  id
  name
  thumbnail {
    url
  }
  record_count
  short_description
  link
  is_new
  is_free
  is_temporary_free
  is_updated
  is_in_color
  has_images
}

fragment FIELD on RecordDisplayField {
  name
  label
  value
}
`;
}
export const collectionPageQuery = "\nquery fetch_collection_page_data($collection: String!, $lang: String) {\n  collection(id: $collection, lang: $lang) {\n    id\n    isNew: is_new\n    isFree: is_free\n    isUpdated: is_updated\n    title: name\n    recordCountText: record_count_text\n    thumbnail {\n        url\n    }\n    recordsAmount: record_count\n    parentCategories: category_chain {\n        id\n        title: name\n        link\n    }\n    categories: parent_categories {\n        id\n        name\n        link\n        recordsAmount: record_count\n    }\n    fullDescription: description\n    shortDescription: short_description\n    seoDescription: seo_description\n    whySearch: why_search\n    faqItems: faq_items {\n      index\n      question\n      answer\n    }\n    historicalRecordsByLocation: historical_records_by_location {\n        name\n        link\n        recordsAmount: record_count\n        flag {\n            url\n        }\n    }\n    sampleRecord: sample_record {\n        title: name\n        subtitle: description\n        description: wiki\n        wikiLink\n        thumbnail: thumbnailUrl\n        recordLink\n    }\n    relatedCollections: related_collections {\n        id\n        title: name\n        link\n        shortDescription: short_description\n        thumbnail {\n            url\n        }\n        recordsAmount: record_count\n        is_free\n        is_new\n        is_updated\n        has_images\n    }\n    formConfig: form_config {\n        id\n        simpleComponents: simple_components\n        advancedComponents: advanced_components\n    }\n    formComponents: form_components {\n        id\n        components: components\n        advancedComponents: advanced_components\n    }\n  }\n}\n";
export function collectionCatalogQuery(lang: string, siteId: string, filters: string, offset: number, limit: number): string {
  return `
{
    search (id: "search-0", lang: "${JSON.stringify(lang).slice(1, -1)}") {
        catalog ${filters} {

summary  {
    total_record_count
    category_chain {
        id
        name
        name_en
    }
    location_chain {
        id
        name
        name_en
    }
    year_range_chain {
        id
        name
    }
    only_with_images
    facets {
        facet_id
        name
        name_en
        collection_count
    }
}
            collections (offset: ${offset}, limit: ${limit}, sort_by: "record_count", site_id: ${JSON.stringify(siteId)}) {
                count
                data {
                    id
                    name
                    category
                    short_description
                    record_count
                    is_free
                    is_new
                    is_updated
                    is_featured
                    has_images
                    link
                    updated_date
                    category_chain {
                        id
                        name
                        name_en
                        link
                    }
                    thumbnail {
                        width
                        height
                        url
                    }
                }
            }
        }
    }
}
`;
}
