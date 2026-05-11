export function openApiHandler(c: any) {
  const origin = new URL(c.req.url).origin;
  return c.json({
    openapi: '3.1.0',
    info: {
      title: 'Filecubby API',
      version: '2.0.0',
      description: 'Owner-operated personal object storage API backed by Cloudflare Workers, Cloudflare KV metadata, and Telegram Bot API chunks.',
    },
    servers: [{ url: origin }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
      schemas: {
        ApiResponse: {
          type: 'object',
          properties: {
            Code: { type: 'integer', enum: [0, 1] },
            Message: { type: 'string' },
          },
        },
        Object: {
          type: 'object',
          properties: {
            namespaceId: { type: 'string', const: 'default' },
            id: { type: 'string' },
            name: { type: 'string' },
            size: { type: 'integer' },
            type: { type: 'string' },
            chunks: { type: 'integer' },
            chunkSize: { type: 'integer' },
            path: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            collectionIds: { type: 'array', items: { type: 'string' } },
            url: { type: 'string' },
          },
        },
        Collection: {
          type: 'object',
          properties: {
            namespaceId: { type: 'string', const: 'default' },
            id: { type: 'string' },
            name: { type: 'string' },
            slug: { type: 'string' },
            description: { type: 'string' },
            path: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/test': { get: { security: [], responses: { '200': { description: 'Health check' } } } },
      '/openapi.json': { get: { security: [], responses: { '200': { description: 'OpenAPI document' } } } },
      '/api/upload': {
        post: {
          summary: 'Upload an object or initialize a chunked upload',
          requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object' } } } },
          responses: { '200': { description: 'Upload response with objectId' } },
        },
      },
      '/api/upload/image': {
        post: {
          summary: 'Upload an image object',
          requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object' } } } },
          responses: { '200': { description: 'Image upload response with objectId' } },
        },
      },
      '/api/upload/status/{objectId}': {
        get: {
          summary: 'Get chunked upload status',
          parameters: [{ name: 'objectId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Upload status' } },
        },
      },
      '/api/upload/finalize/{objectId}': {
        post: {
          summary: 'Finalize a chunked upload',
          parameters: [{ name: 'objectId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Finalize response' } },
        },
      },
      '/api/objects': {
        get: {
          summary: 'List objects',
          parameters: [
            { name: 'path', in: 'query', schema: { type: 'string' } },
            { name: 'tag', in: 'query', schema: { type: 'string' } },
            { name: 'collectionId', in: 'query', schema: { type: 'string' } },
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { '200': { description: 'Object list' } },
        },
      },
      '/api/objects/{id}': {
        get: {
          summary: 'Get object metadata',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Object metadata' } },
        },
        patch: {
          summary: 'Update object metadata',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { '200': { description: 'Updated object metadata' } },
        },
      },
      '/api/collections': {
        get: { summary: 'List collections', responses: { '200': { description: 'Collections' } } },
        post: {
          summary: 'Create collection',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Collection' } } } },
          responses: { '200': { description: 'Created collection' } },
        },
      },
      '/api/collections/{id}': {
        get: {
          summary: 'Get collection',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Collection' } },
        },
        patch: {
          summary: 'Update collection',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { '200': { description: 'Updated collection' } },
        },
        delete: {
          summary: 'Delete collection',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Deleted collection' } },
        },
      },
      '/api/repair/import-telegram': {
        post: {
          summary: 'Import KV object metadata from visible Telegram manifests and captions',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    dryRun: { type: 'boolean', default: true },
                    overwrite: { type: 'boolean', default: false },
                    limit: { type: 'integer', default: 100 },
                    offset: { type: 'integer' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Import report' } },
        },
      },
      '/d/{objectId}': {
        get: {
          security: [],
          summary: 'Download or stream an object',
          parameters: [{ name: 'objectId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Object bytes' }, '206': { description: 'Range response' } },
        },
        head: {
          security: [],
          summary: 'Inspect download headers',
          parameters: [{ name: 'objectId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Object headers' } },
        },
      },
    },
  });
}
