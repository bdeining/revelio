import schema from 'raw-loader!./metacards.graphql'

const { write } = require('../cql')

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

  const extendedSchema = `
    extend type MetacardAttributes {
      ${attrs()}
    }

    extend type MetacardAttributesInput {
      ${attrs(true)}
    }
  `

  return {
    resolver: metacards,
    context: {
      toGraphqlName,
      fromGraphqlName,
    },
    typeDefs: [schema, extendedSchema],
  }
}
