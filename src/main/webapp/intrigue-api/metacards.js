import gql from 'graphql-tag'
import { print } from 'graphql/language/printer'

const typeDefs = attrs => gql`
  scalar Json
  # Binary content embedded as a base64 String
  scalar Binary
  # WKT embedded as a String
  scalar Geometry
  # XML embedded as a String
  scalar XML
  # ISO 8601 Data Time embedded as a String
  scalar Date

  # Common and well known metacard attributes intended for progrmatic usage
  type MetacardAttributes {
  ${attrs()}
  }

  input MetacardAttributesInput {
  ${attrs(true)}
  }

  enum Direction {
    # Smaller to Larger values
    asc
    # Smaller to Larger values
    ascending
    # Larger to Smaller values
    desc
    # Larger to Smaller values
    descending
  }

  input QuerySortInput {
    attribute: String
    direction: Direction
  }

  type QuerySort {
    attribute: String
    direction: Direction
  }

  input QuerySettingsInput {
    src: String
    federation: String
    phonetics: Boolean
    sorts: [QuerySortInput]
    spellcheck: Boolean

    # Page size
    count: Int

    # Start of paging. First element is 1, not 0.
    start: Int
    type: String
  }

  type QueryResponseStatus {
    count: Int
    elapsed: Int
    hits: Int
    id: ID
    successful: Boolean
  }

  type MetacardAction {
    description: String
    displayName: String
    id: ID
    title: String
    url: String
  }

  type QueryResponseResult {
    actions: [MetacardAction]
    # All known metacard attributes with raw attributes names.
    # This is intended for views that are interested in:
    # 1. Using raw attribute names.
    # 2. Attribute aliasing that require raw attribute names.
    # 3. Getting all the possible attributes.
    metacard: Json
  }

  type QueryResponse {
    results: [QueryResponseResult]
    attributes: [MetacardAttributes]
    status: QueryResponseStatus
  }

  extend type Query {
    metacards(filterTree: Json!, settings: QuerySettingsInput): QueryResponse
  }
`

const { write } = require('./cql')

const getCql = ({ filterTree, cql }) => {
  if (filterTree !== undefined) {
    return '(' + write(filterTree) + ')'
  }
  return cql
}

const processQuery = ({ filterTree, cql, ...query }) => {
  const cqlString = getCql({ filterTree, cql })
  return { cql: cqlString, ...query }
}

const renameKeys = (fn, map) => {
  return Object.keys(map).reduce((attrs, attr) => {
    const name = fn(attr)
    attrs[name] = map[attr]
    return attrs
  }, {})
}

const queries = (ids = []) => async (args, context) => {
  if (ids.length === 0) {
    return []
  }

  const filters = ids.map(id => {
    return {
      type: '=',
      property: 'id',
      value: id,
    }
  })

  const filterTree = {
    type: 'AND',
    filters: [
      {
        type: 'OR',
        filters,
      },
      {
        type: 'LIKE',
        property: 'metacard-tags',
        value: '%',
      },
    ],
  }

  const res = await metacards({}, { filterTree }, context)

  return res.attributes.map(attrs => {
    const { filterTree } = attrs

    return {
      ...attrs,
      filterTree: () => JSON.parse(filterTree),
    }
  })
}

const metacards = async (parent, args, { toGraphqlName, catalog }) => {
  const q = { ...args.settings, filterTree: args.filterTree }
  const json = await catalog.query(processQuery(q))

  const attributes = json.results.map(result => {
    const properties = renameKeys(toGraphqlName, result.metacard.properties)
    return {
      ...properties,
      queries: queries(properties.queries),
    }
  })
  json.status['elapsed'] = json.request_duration_millis
  return { attributes, ...json }
}

// DDF types -> GraphQL types
const typeMap = {
  STRING: 'String',
  DOUBLE: 'Float',
  INTEGER: 'Int',
  LONG: 'Int',
  BOOLEAN: 'Boolean',
  BINARY: 'Binary',
  GEOMETRY: 'Geometry',
  XML: 'XML',
  DATE: 'Date',
  JSON: 'Json',
}

export default attributes => {
  const toGraphqlName = name => name.replace(/-|\./g, '_')

  const idMap = attributes.map(a => a.id).reduce((map, id) => {
    map[toGraphqlName(id)] = id
    return map
  }, {})

  const fromGraphqlName = name => idMap[name] || name

  const attrs = input => {
    return attributes
      .map(attr => {
        const { id, multivalued, type } = attr
        const name = toGraphqlName(id)
        let graphQLType = typeMap[type] || type + (input ? 'Input' : '')

        if (multivalued) {
          graphQLType = `[${graphQLType}]`
        }

        return `  # metacard attribute: **\`${id}\`**\n  ${name}: ${graphQLType}`
      })
      .join('\n')
  }

  return {
    resolver: metacards,
    context: {
      toGraphqlName,
      fromGraphqlName,
    },
    typeDefs: [print(typeDefs(attrs))],
  }
}
