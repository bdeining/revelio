const createRpcClient = require('./rpc')

const request = createRpcClient()

const methods = {
  create: 'ddf.catalog/create',
  query: 'ddf.catalog/query',
  update: 'ddf.catalog/update',
  delete: 'ddf.catalog/delete',
  getSourceIds: 'ddf.catalog/getSourceIds',
  getSourceInfo: 'ddf.catalog/getSourceInfo',
}

const catalog = Object.keys(methods).reduce((catalog, method) => {
  catalog[method] = params => request(methods[method], params)
  return catalog
}, {})

export default catalog
