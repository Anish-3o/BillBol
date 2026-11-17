import type { Aggregate, MongooseQueryMiddleware, Query, Schema } from 'mongoose';

// Every query operation that reads, changes or deletes existing documents.
const QUERY_OPS: MongooseQueryMiddleware[] = [
  'find',
  'findOne',
  'countDocuments',
  'distinct',
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
];

// Safety net for multi-tenancy. Rule 1 says every query must filter by tenant; this plugin
// makes forgetting it impossible to miss: a query on a tenant-scoped model without a tenantId
// in its filter throws (a loud 500 and a failing test) instead of quietly returning or
// changing other shops' data.
//
// It checks that a tenantId is present, not where it came from. Services must still take it
// from the logged-in user (getAuth(req).tenantId), never from the request body.
//
// Gotchas this causes on purpose:
// - findById(id) throws: use findOne({ _id: id, tenantId }) instead.
// - populate() into a tenant-scoped model needs match: { tenantId }.
export function tenantScoped(schema: Schema): void {
  schema.pre(QUERY_OPS, function (this: Query<unknown, unknown>) {
    if (!hasTenantId(this.getFilter())) {
      throw new Error(
        `${this.model.modelName} query without a tenantId filter. ` +
          'Every query on tenant data must include { tenantId }.',
      );
    }
  });

  schema.pre('aggregate', function (this: Aggregate<unknown>) {
    // The tenant filter must be the first stage, so no later stage ever sees other shops' data.
    const first = this.pipeline()[0] as { $match?: Record<string, unknown> } | undefined;
    if (!first?.$match || !hasTenantId(first.$match)) {
      throw new Error('aggregate() on tenant data must start with { $match: { tenantId } }.');
    }
  });
}

function hasTenantId(filter: Record<string, unknown>): boolean {
  return filter.tenantId !== undefined && filter.tenantId !== null;
}
