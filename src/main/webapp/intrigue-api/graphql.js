import { InMemoryCache } from 'apollo-cache-inmemory'
import { ApolloClient } from 'apollo-client'
import { SchemaLink } from 'apollo-link-schema'
import { makeExecutableSchema } from 'graphql-tools'
import { fromJS, getIn, removeIn, set, setIn } from 'immutable'
import { mergeDeepOverwriteLists } from '../utils'
const { BatchHttpLink } = require('apollo-link-batch-http')
const { genSchema, toGraphqlName, fromGraphqlName } = require('./gen-schema')
import { Set } from 'immutable'
import { validate } from 'graphql/validation'

import metacardsModule from './metacards'

import attributes from './attributes.json'

const {
  resolver: metacards,
  context: metacardsContext,
  typeDefs: metacardTypeDefs,
} = metacardsModule(attributes)

const ROOT = '/search/catalog/internal'

const filterDeepHelper = filterFunction => object =>
  object
    .filter(filterFunction)
    .map(
      object =>
        typeof object !== 'object' || object === null
          ? object
          : filterDeepHelper(filterFunction)(object)
    )

const filterDeep = filterFunction => object =>
  filterDeepHelper(filterFunction)(fromJS(object)).toJS()

const removeTypenameFields = object =>
  filterDeep((_, key) => key !== '__typename')(object)

const removeNullValues = object => filterDeep(value => value !== null)(object)

const getBuildInfo = () => {
  /* eslint-disable */
  const commitHash = __COMMIT_HASH__
  const isDirty = __IS_DIRTY__
  const commitDate = __COMMIT_DATE__
  /* eslint-enable */

  return {
    commitHash,
    isDirty,
    commitDate,
    identifier: `${commitHash.trim()}${isDirty ? ' with Changes' : ''}`,
    releaseDate: commitDate,
  }
}

const systemProperties = async (parent, args, { fetch }) => {
  const [configProperties, configUiProperties] = await Promise.all([
    (await fetch(`${ROOT}/config`)).json(),
    (await fetch(`${ROOT}/platform/config/ui`)).json(),
  ])
  return {
    ...configProperties,
    ...configUiProperties,
    ...getBuildInfo(),
  }
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0

const renameKeys = (f, map) => {
  return Object.keys(map).reduce((attrs, attr) => {
    const name = f(attr)
    attrs[name] = map[attr]
    return attrs
  }, {})
}

const toGraphqlMap = map => {
  return Object.keys(map).reduce((attrs, attr) => {
    const name = toGraphqlName(attr)
    attrs[name] = map[attr]
    return attrs
  }, {})
}

const fromGraphqlMap = map => {
  return Object.keys(map).reduce((attrs, attr) => {
    const name = fromGraphqlName(attr)
    attrs[name] = map[attr]
    return attrs
  }, {})
}

const queryTemplates = {
  accessAdministrators: 'security_access_administrators',
  accessGroups: 'security_access_groups',
  accessGroupsRead: 'security_access_groups_read',
  accessIndividuals: 'security_access_individuals',
  accessIndividualsRead: 'security_access_individuals_read',
  created: 'created',
  filterTemplate: 'filter_template',
  modified: 'modified',
  owner: 'metacard_owner',
  querySettings: 'query_settings',
  id: 'id',
  title: 'title',
}

const fetchQueryTemplates = async (parent, args, { fetch }) => {
  const res = await fetch(`${ROOT}/forms/query`)
  const json = await res.json()
  const attributes = json
    .map(attrs => renameKeys(k => queryTemplates[k], attrs))
    .map(({ modified, created, ...rest }) => {
      return {
        ...rest,
        created: new Date(created).toISOString(),
        modified: new Date(modified).toISOString(),
      }
    })
  const status = {
    // count: Int
    // elapsed: Int
    // hits: Int
    // id: ID
    // successful: Boolean
    count: attributes.length,
    successful: true,
    hits: attributes.length,
  }
  return { attributes, status }
}

const metacardsByTag = async (parent, args, context) => {
  //TO-DO: Fix this to use graphql context
  if (args.tag === 'query-template') {
    return fetchQueryTemplates()
  }

  return metacards(
    parent,
    {
      filterTree: {
        type: '=',
        property: 'metacard-tags',
        value: args.tag,
      },
      settings: args.settings,
    },
    context
  )
}

const metacardById = async (parent, args, context) => {
  return metacards(
    parent,
    {
      filterTree: {
        type: 'AND',
        filters: [
          {
            type: '=',
            property: 'id',
            value: args.id,
          },
          {
            type: 'LIKE',
            property: 'metacard-tags',
            value: '%',
          },
        ],
      },
      settings: args.settings,
    },
    context
  )
}

const preferencesToGraphql = preferences => {
  const transformed = setIn(
    preferences,
    ['querySettings', 'detail_level'],
    getIn(preferences, ['querySettings', 'detail-level'])
  )
  return removeIn(transformed, ['querySettings', 'detail-level'])
}

const preferencesFromGraphql = preferences => {
  const transformed = setIn(
    preferences,
    ['querySettings', 'detail-level'],
    getIn(preferences, ['querySettings', 'detail_level'])
  )
  return removeIn(transformed, ['querySettings', 'detail_level'])
}

const user = async (parent, args, { fetch }) => {
  const res = await fetch(`${ROOT}/user`)
  const json = await res.json()

  return setIn(json, ['preferences'], () =>
    preferencesToGraphql(json.preferences)
  )
}

const getLocalCatalogId = async (parent, args, { fetch }) => {
  const res = await fetch(`${ROOT}/localcatalogid`)
  return res.json()
}

const sources = async (parent, args, context) => {
  const { catalog } = context
  const sourceIds = await catalog.getSourceIds({})
  const res = await catalog.getSourceInfo({ ids: sourceIds })
  //TO-DO: cache this in future, local catalog id doesn't change
  const local = await getLocalCatalogId(parent, args, context)

  return res.sourceInfo.map(source =>
    set(source, 'local', source.id === local['local-catalog-id'])
  )
}

const metacardStartingTypes = [
  {
    id: 'anyText',
    type: 'STRING',
    multivalued: false,
    isInjected: false,
    enums: [],
  },
  {
    id: 'anyGeo',
    type: 'LOCATION',
    multivalued: false,
    isInjected: false,
    enums: [],
  },
  {
    id: ' metacard-type',
    type: 'STRING',
    multivalued: false,
    isInjected: false,
    enums: [],
  },
  {
    id: 'source-id',
    type: 'STRING',
    multivalued: false,
    isInjected: false,
    enums: [],
  },
  {
    id: 'cached',
    type: 'STRING',
    multivalued: false,
    isInjected: false,
    enums: [],
  },
  {
    id: 'metacard-tags',
    type: 'STRING',
    multivalued: true,
    isInjected: false,
    enums: [],
  },
]

const metacardTypes = async (parent, args, { fetch }) => {
  const res = await fetch(`${ROOT}/metacardtype`)
  const json = await res.json()

  const types = Object.keys(json).reduce((types, group) => {
    return Object.assign(types, json[group])
  }, {})
  const enums = await getEnumerations(parent, args, { fetch })
  Object.keys(enums).forEach(attribute => {
    types[attribute].enums = enums[attribute]
  })
  return metacardStartingTypes.concat(Object.keys(types).map(k => types[k]))
}

const getEnumerations = async (parent, args, { fetch }) => {
  const { enums } = await (await fetch(`${ROOT}/config`)).json()

  const res = await fetch(`${ROOT}/metacardtype`)
  const json = await res.json()

  await Promise.all(
    Object.keys(json).map(async group => {
      const enumRes = await fetch(`${ROOT}/enumerations/metacardtype/${group}`)
      const enumJson = await enumRes.json()
      Object.assign(enums, enumJson)
    })
  )
  return enums
}

const facet = async (parent, args, { catalog }) => {
  const { attribute } = args

  const filterTree = {
    type: 'ILIKE',
    property: 'anyText',
    value: '%',
  }

  const q = {
    filterTree,
    count: 0,
    facets: [attribute],
  }

  const json = await catalog.query(processQuery(q))

  const facet = json.facets[attribute]

  return facet
}

const Query = {
  //user,
  //sources,
  metacards,
  /*
  metacardsByTag,
  metacardById,
  metacardTypes,
  systemProperties,
  facet,*/
}

const createMetacard = async (parent, args, { catalog }) => {
  const { attrs } = args

  const metacard = fromGraphqlMap(attrs)

  const metacardsToCreate = {
    metacards: [
      {
        'metacard-type': attrs['metacard_type'],
        attributes: metacard,
      },
    ],
  }

  const res = await catalog.create(metacardsToCreate)
  return toGraphqlMap(res.created_metacards[0].attributes)
}
const saveMetacard = async (parent, args, { fetch }) => {
  const { id, attrs } = args

  const attributes = Object.keys(attrs).map(attribute => {
    const value = attrs[attribute]
    return {
      attribute: fromGraphqlName(attribute),
      values: Array.isArray(value) ? value : [value],
    }
  })

  const body = [
    {
      ids: [id],
      attributes,
    },
  ]

  const res = await fetch(`${ROOT}/metacards`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (res.ok) {
    const modified = new Date().toISOString()
    return toGraphqlMap({
      id,
      'metacard.modified': modified,
      ...attrs,
    })
  }
}

const deleteMetacard = async (parent, args, { catalog }) => {
  const { id } = args
  await catalog.delete({ ids: [id] })
  return id
}

const updateUserPreferences = async (parent, args, { fetch }) => {
  const { userPreferences } = args

  const user = await fetch(`${ROOT}/user`)
  const json = await user.json()
  let previousPreferences = {}
  if (user.ok) {
    previousPreferences = json.preferences
  }

  const body = mergeDeepOverwriteLists(
    fromJS(previousPreferences),
    fromJS(preferencesFromGraphql(removeTypenameFields(userPreferences)))
  ).toJS()

  const res = await fetch(`${ROOT}/user/preferences`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(removeNullValues(body)),
  })

  if (res.ok) {
    return userPreferences
  }
}

const Mutation = {
  createMetacard,
  saveMetacard,
  deleteMetacard,
  updateUserPreferences,
}

const resolvers = {
  Query,
  //Mutation,
}

const typeDefs = Set(['type Query { _: Boolean }', ...metacardTypeDefs]).join(
  '\n'
)

const executableSchema = makeExecutableSchema({
  typeDefs,
  resolvers,
})

const serverLocation =
  process.env.SERVER_LOCATION || 'http://localhost:8080/graphql'

const defaultOptions = {
  ssrMode: false,
}

const btoa = arg =>
  typeof window !== 'undefined'
    ? window.btoa(arg)
    : Buffer.from(arg).toString('base64')

export const context = {
  ...metacardsContext,
}

const createClient = (options = defaultOptions) => {
  const cache = new InMemoryCache()
  const { ssrMode } = options
  const auth = btoa('admin:admin')
  if (typeof window !== 'undefined') {
    cache.restore(window.__APOLLO_STATE__)
  }
  return new ApolloClient({
    link: ssrMode
      ? new SchemaLink({ schema: executableSchema, context })
      : new BatchHttpLink({
          uri: serverLocation,
          credentials: 'same-origin',
          headers: {
            Authorization: `Basic ${auth}`,
          },
        }),
    cache,
    ssrMode,
  })
}

module.exports = {
  context,
  createClient,
  typeDefs,
  resolvers,
}
