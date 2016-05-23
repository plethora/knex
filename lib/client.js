'use strict';

exports.__esModule = true;

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj['default'] = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _promise = require('./promise');

var _promise2 = _interopRequireDefault(_promise);

var _helpers = require('./helpers');

var helpers = _interopRequireWildcard(_helpers);

var _raw = require('./raw');

var _raw2 = _interopRequireDefault(_raw);

var _runner = require('./runner');

var _runner2 = _interopRequireDefault(_runner);

var _formatter = require('./formatter');

var _formatter2 = _interopRequireDefault(_formatter);

var _transaction = require('./transaction');

var _transaction2 = _interopRequireDefault(_transaction);

var _queryBuilder = require('./query/builder');

var _queryBuilder2 = _interopRequireDefault(_queryBuilder);

var _queryCompiler = require('./query/compiler');

var _queryCompiler2 = _interopRequireDefault(_queryCompiler);

var _schemaBuilder = require('./schema/builder');

var _schemaBuilder2 = _interopRequireDefault(_schemaBuilder);

var _schemaCompiler = require('./schema/compiler');

var _schemaCompiler2 = _interopRequireDefault(_schemaCompiler);

var _schemaTablebuilder = require('./schema/tablebuilder');

var _schemaTablebuilder2 = _interopRequireDefault(_schemaTablebuilder);

var _schemaTablecompiler = require('./schema/tablecompiler');

var _schemaTablecompiler2 = _interopRequireDefault(_schemaTablecompiler);

var _schemaColumnbuilder = require('./schema/columnbuilder');

var _schemaColumnbuilder2 = _interopRequireDefault(_schemaColumnbuilder);

var _schemaColumncompiler = require('./schema/columncompiler');

var _schemaColumncompiler2 = _interopRequireDefault(_schemaColumncompiler);

var _pool2 = require('pool2');

var _pool22 = _interopRequireDefault(_pool2);

var _inherits = require('inherits');

var _inherits2 = _interopRequireDefault(_inherits);

var _events = require('events');

var _queryString = require('./query/string');

var _queryString2 = _interopRequireDefault(_queryString);

var _lodash = require('lodash');

var debug = require('debug')('knex:client');
var debugQuery = require('debug')('knex:query');

// The base client provides the general structure
// for a dialect specific client object.
function Client() {
  var config = arguments.length <= 0 || arguments[0] === undefined ? {} : arguments[0];

  this.config = config;
  this.formattedDebugLog = config.formattedDebugLog;
  this.connectionSettings = _lodash.cloneDeep(config.connection || {});
  if (this.driverName && config.connection) {
    this.initializeDriver();
    if (!config.pool || config.pool && config.pool.max !== 0) {
      this.initializePool(config);
    }
  }
  this.valueForUndefined = this.raw('DEFAULT');
  if (config.useNullAsDefault) {
    this.valueForUndefined = null;
  }
}
_inherits2['default'](Client, _events.EventEmitter);

_lodash.assign(Client.prototype, {

  Formatter: _formatter2['default'],

  formatter: function formatter() {
    return new this.Formatter(this);
  },

  QueryBuilder: _queryBuilder2['default'],

  queryBuilder: function queryBuilder() {
    return new this.QueryBuilder(this);
  },

  QueryCompiler: _queryCompiler2['default'],

  queryCompiler: function queryCompiler(builder) {
    return new this.QueryCompiler(this, builder);
  },

  SchemaBuilder: _schemaBuilder2['default'],

  schemaBuilder: function schemaBuilder() {
    return new this.SchemaBuilder(this);
  },

  SchemaCompiler: _schemaCompiler2['default'],

  schemaCompiler: function schemaCompiler(builder) {
    return new this.SchemaCompiler(this, builder);
  },

  TableBuilder: _schemaTablebuilder2['default'],

  tableBuilder: function tableBuilder(type, tableName, fn) {
    return new this.TableBuilder(this, type, tableName, fn);
  },

  TableCompiler: _schemaTablecompiler2['default'],

  tableCompiler: function tableCompiler(tableBuilder) {
    return new this.TableCompiler(this, tableBuilder);
  },

  ColumnBuilder: _schemaColumnbuilder2['default'],

  columnBuilder: function columnBuilder(tableBuilder, type, args) {
    return new this.ColumnBuilder(this, tableBuilder, type, args);
  },

  ColumnCompiler: _schemaColumncompiler2['default'],

  columnCompiler: function columnCompiler(tableBuilder, columnBuilder) {
    return new this.ColumnCompiler(this, tableBuilder, columnBuilder);
  },

  Runner: _runner2['default'],

  runner: function runner(connection) {
    return new this.Runner(this, connection);
  },

  SqlString: _queryString2['default'],

  Transaction: _transaction2['default'],

  transaction: function transaction(container, config, outerTx) {
    return new this.Transaction(this, container, config, outerTx);
  },

  Raw: _raw2['default'],

  raw: function raw() {
    var raw = new this.Raw(this);
    return raw.set.apply(raw, arguments);
  },

  query: function query(connection, obj) {
    var _this = this;

    if (typeof obj === 'string') obj = { sql: obj };
    this.emit('query', _lodash.assign({ __knexUid: connection.__knexUid }, obj));
    debugQuery(obj.sql);
    return this._query.call(this, connection, obj)['catch'](function (err) {
      err.message = _queryString2['default'].format(obj.sql, obj.bindings) + ' - ' + err.message;
      _this.emit('query-error', err, _lodash.assign({ __knexUid: connection.__knexUid }, obj));
      throw err;
    });
  },

  stream: function stream(connection, obj, _stream, options) {
    if (typeof obj === 'string') obj = { sql: obj };
    this.emit('query', _lodash.assign({ __knexUid: connection.__knexUid }, obj));
    debugQuery(obj.sql);
    return this._stream.call(this, connection, obj, _stream, options);
  },

  prepBindings: function prepBindings(bindings) {
    return bindings;
  },

  wrapIdentifier: function wrapIdentifier(value) {
    return value !== '*' ? '"' + value.replace(/"/g, '""') + '"' : '*';
  },

  initializeDriver: function initializeDriver() {
    try {
      this.driver = this._driver();
    } catch (e) {
      helpers.exit('Knex: run\n$ npm install ' + this.driverName + ' --save\n' + e.stack);
    }
  },

  Pool: _pool22['default'],

  initializePool: function initializePool(config) {
    if (this.pool) this.destroy();
    this.pool = new this.Pool(_lodash.assign(this.poolDefaults(config.pool || {}), config.pool));
    this.pool.on('error', function (err) {
      helpers.error('Pool2 - ' + err);
    });
    this.pool.on('warn', function (msg) {
      helpers.warn('Pool2 - ' + msg);
    });
  },

  poolDefaults: function poolDefaults(poolConfig) {
    var client = this;
    return {
      min: 2,
      max: 10,
      acquire: function acquire(callback) {
        client.acquireRawConnection().tap(function (connection) {
          connection.__knexUid = _lodash.uniqueId('__knexUid');
          if (poolConfig.afterCreate) {
            return _promise2['default'].promisify(poolConfig.afterCreate)(connection);
          }
        }).asCallback(callback);
      },
      dispose: function dispose(connection, callback) {
        if (poolConfig.beforeDestroy) {
          poolConfig.beforeDestroy(connection, function () {
            if (connection !== undefined) {
              client.destroyRawConnection(connection, callback);
            }
          });
        } else if (connection !== void 0) {
          client.destroyRawConnection(connection, callback);
        }
      },
      ping: function ping(resource, callback) {
        return client.ping(resource, callback);
      }
    };
  },

  // Acquire a connection from the pool.
  acquireConnection: function acquireConnection() {
    var client = this;
    var request = null;
    var completed = new _promise2['default'](function (resolver, rejecter) {
      if (!client.pool) {
        return rejecter(new Error('There is no pool defined on the current client'));
      }
      request = client.pool.acquire(function (err, connection) {
        if (err) return rejecter(err);
        debug('acquired connection from pool: %s', connection.__knexUid);
        resolver(connection);
      });
    });
    var abort = function abort(reason) {
      if (request && !request.fulfilled) {
        request.abort(reason);
      }
    };
    return {
      completed: completed,
      abort: abort
    };
  },

  // Releases a connection back to the connection pool,
  // returning a promise resolved when the connection is released.
  releaseConnection: function releaseConnection(connection) {
    var pool = this.pool;

    return new _promise2['default'](function (resolver) {
      debug('releasing connection to pool: %s', connection.__knexUid);
      pool.release(connection);
      resolver();
    });
  },

  // Destroy the current connection pool for the client.
  destroy: function destroy(callback) {
    var client = this;
    var promise = new _promise2['default'](function (resolver) {
      if (!client.pool) return resolver();
      client.pool.end(function () {
        client.pool = undefined;
        resolver();
      });
    });
    // Allow either a callback or promise interface for destruction.
    if (typeof callback === 'function') {
      promise.asCallback(callback);
    } else {
      return promise;
    }
  },

  // Return the database being used by this client.
  database: function database() {
    return this.connectionSettings.database;
  },

  toString: function toString() {
    return '[object KnexClient]';
  }

});

exports['default'] = Client;
module.exports = exports['default'];
//# sourceMappingURL=data:application/json;base64,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O0tBQ1gsQ0FBQyxDQUFBO0dBQ0g7OztBQUdELFNBQU8sRUFBQSxpQkFBQyxRQUFRLEVBQUU7QUFDaEIsUUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFBO0FBQ25CLFFBQU0sT0FBTyxHQUFHLHlCQUFZLFVBQVMsUUFBUSxFQUFFO0FBQzdDLFVBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLE9BQU8sUUFBUSxFQUFFLENBQUE7QUFDbkMsWUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsWUFBVztBQUN6QixjQUFNLENBQUMsSUFBSSxHQUFHLFNBQVMsQ0FBQTtBQUN2QixnQkFBUSxFQUFFLENBQUE7T0FDWCxDQUFDLENBQUE7S0FDSCxDQUFDLENBQUE7O0FBRUYsUUFBSSxPQUFPLFFBQVEsS0FBSyxVQUFVLEVBQUU7QUFDbEMsYUFBTyxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUMsQ0FBQTtLQUM3QixNQUFNO0FBQ0wsYUFBTyxPQUFPLENBQUE7S0FDZjtHQUNGOzs7QUFHRCxVQUFRLEVBQUEsb0JBQUc7QUFDVCxXQUFPLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxRQUFRLENBQUE7R0FDeEM7O0FBRUQsVUFBUSxFQUFBLG9CQUFHO0FBQ1QsV0FBTyxxQkFBcUIsQ0FBQTtHQUM3Qjs7Q0FFRixDQUFDLENBQUE7O3FCQUVhLE1BQU0iLCJmaWxlIjoiY2xpZW50LmpzIiwic291cmNlc0NvbnRlbnQiOlsiXG5pbXBvcnQgUHJvbWlzZSBmcm9tICcuL3Byb21pc2UnO1xuaW1wb3J0ICogYXMgaGVscGVycyBmcm9tICcuL2hlbHBlcnMnO1xuXG5pbXBvcnQgUmF3IGZyb20gJy4vcmF3JztcbmltcG9ydCBSdW5uZXIgZnJvbSAnLi9ydW5uZXInO1xuaW1wb3J0IEZvcm1hdHRlciBmcm9tICcuL2Zvcm1hdHRlcic7XG5pbXBvcnQgVHJhbnNhY3Rpb24gZnJvbSAnLi90cmFuc2FjdGlvbic7XG5cbmltcG9ydCBRdWVyeUJ1aWxkZXIgZnJvbSAnLi9xdWVyeS9idWlsZGVyJztcbmltcG9ydCBRdWVyeUNvbXBpbGVyIGZyb20gJy4vcXVlcnkvY29tcGlsZXInO1xuXG5pbXBvcnQgU2NoZW1hQnVpbGRlciBmcm9tICcuL3NjaGVtYS9idWlsZGVyJztcbmltcG9ydCBTY2hlbWFDb21waWxlciBmcm9tICcuL3NjaGVtYS9jb21waWxlcic7XG5pbXBvcnQgVGFibGVCdWlsZGVyIGZyb20gJy4vc2NoZW1hL3RhYmxlYnVpbGRlcic7XG5pbXBvcnQgVGFibGVDb21waWxlciBmcm9tICcuL3NjaGVtYS90YWJsZWNvbXBpbGVyJztcbmltcG9ydCBDb2x1bW5CdWlsZGVyIGZyb20gJy4vc2NoZW1hL2NvbHVtbmJ1aWxkZXInO1xuaW1wb3J0IENvbHVtbkNvbXBpbGVyIGZyb20gJy4vc2NoZW1hL2NvbHVtbmNvbXBpbGVyJztcblxuaW1wb3J0IFBvb2wyIGZyb20gJ3Bvb2wyJztcbmltcG9ydCBpbmhlcml0cyBmcm9tICdpbmhlcml0cyc7XG5pbXBvcnQgeyBFdmVudEVtaXR0ZXIgfSBmcm9tICdldmVudHMnO1xuaW1wb3J0IFNxbFN0cmluZyBmcm9tICcuL3F1ZXJ5L3N0cmluZyc7XG5cbmltcG9ydCB7IGFzc2lnbiwgdW5pcXVlSWQsIGNsb25lRGVlcCB9IGZyb20gJ2xvZGFzaCdcblxuY29uc3QgZGVidWcgPSByZXF1aXJlKCdkZWJ1ZycpKCdrbmV4OmNsaWVudCcpXG5jb25zdCBkZWJ1Z1F1ZXJ5ID0gcmVxdWlyZSgnZGVidWcnKSgna25leDpxdWVyeScpXG5cbi8vIFRoZSBiYXNlIGNsaWVudCBwcm92aWRlcyB0aGUgZ2VuZXJhbCBzdHJ1Y3R1cmVcbi8vIGZvciBhIGRpYWxlY3Qgc3BlY2lmaWMgY2xpZW50IG9iamVjdC5cbmZ1bmN0aW9uIENsaWVudChjb25maWcgPSB7fSkge1xuICB0aGlzLmNvbmZpZyA9IGNvbmZpZ1xuICB0aGlzLmZvcm1hdHRlZERlYnVnTG9nID0gY29uZmlnLmZvcm1hdHRlZERlYnVnTG9nXG4gIHRoaXMuY29ubmVjdGlvblNldHRpbmdzID0gY2xvbmVEZWVwKGNvbmZpZy5jb25uZWN0aW9uIHx8IHt9KVxuICBpZiAodGhpcy5kcml2ZXJOYW1lICYmIGNvbmZpZy5jb25uZWN0aW9uKSB7XG4gICAgdGhpcy5pbml0aWFsaXplRHJpdmVyKClcbiAgICBpZiAoIWNvbmZpZy5wb29sIHx8IChjb25maWcucG9vbCAmJiBjb25maWcucG9vbC5tYXggIT09IDApKSB7XG4gICAgICB0aGlzLmluaXRpYWxpemVQb29sKGNvbmZpZylcbiAgICB9XG4gIH1cbiAgdGhpcy52YWx1ZUZvclVuZGVmaW5lZCA9IHRoaXMucmF3KCdERUZBVUxUJyk7XG4gIGlmIChjb25maWcudXNlTnVsbEFzRGVmYXVsdCkge1xuICAgIHRoaXMudmFsdWVGb3JVbmRlZmluZWQgPSBudWxsXG4gIH1cbn1cbmluaGVyaXRzKENsaWVudCwgRXZlbnRFbWl0dGVyKVxuXG5hc3NpZ24oQ2xpZW50LnByb3RvdHlwZSwge1xuXG4gIEZvcm1hdHRlcixcblxuICBmb3JtYXR0ZXIoKSB7XG4gICAgcmV0dXJuIG5ldyB0aGlzLkZvcm1hdHRlcih0aGlzKVxuICB9LFxuXG4gIFF1ZXJ5QnVpbGRlcixcblxuICBxdWVyeUJ1aWxkZXIoKSB7XG4gICAgcmV0dXJuIG5ldyB0aGlzLlF1ZXJ5QnVpbGRlcih0aGlzKVxuICB9LFxuXG4gIFF1ZXJ5Q29tcGlsZXIsXG5cbiAgcXVlcnlDb21waWxlcihidWlsZGVyKSB7XG4gICAgcmV0dXJuIG5ldyB0aGlzLlF1ZXJ5Q29tcGlsZXIodGhpcywgYnVpbGRlcilcbiAgfSxcblxuICBTY2hlbWFCdWlsZGVyLFxuXG4gIHNjaGVtYUJ1aWxkZXIoKSB7XG4gICAgcmV0dXJuIG5ldyB0aGlzLlNjaGVtYUJ1aWxkZXIodGhpcylcbiAgfSxcblxuICBTY2hlbWFDb21waWxlcixcblxuICBzY2hlbWFDb21waWxlcihidWlsZGVyKSB7XG4gICAgcmV0dXJuIG5ldyB0aGlzLlNjaGVtYUNvbXBpbGVyKHRoaXMsIGJ1aWxkZXIpXG4gIH0sXG5cbiAgVGFibGVCdWlsZGVyLFxuXG4gIHRhYmxlQnVpbGRlcih0eXBlLCB0YWJsZU5hbWUsIGZuKSB7XG4gICAgcmV0dXJuIG5ldyB0aGlzLlRhYmxlQnVpbGRlcih0aGlzLCB0eXBlLCB0YWJsZU5hbWUsIGZuKVxuICB9LFxuXG4gIFRhYmxlQ29tcGlsZXIsXG5cbiAgdGFibGVDb21waWxlcih0YWJsZUJ1aWxkZXIpIHtcbiAgICByZXR1cm4gbmV3IHRoaXMuVGFibGVDb21waWxlcih0aGlzLCB0YWJsZUJ1aWxkZXIpXG4gIH0sXG5cbiAgQ29sdW1uQnVpbGRlcixcblxuICBjb2x1bW5CdWlsZGVyKHRhYmxlQnVpbGRlciwgdHlwZSwgYXJncykge1xuICAgIHJldHVybiBuZXcgdGhpcy5Db2x1bW5CdWlsZGVyKHRoaXMsIHRhYmxlQnVpbGRlciwgdHlwZSwgYXJncylcbiAgfSxcblxuICBDb2x1bW5Db21waWxlcixcblxuICBjb2x1bW5Db21waWxlcih0YWJsZUJ1aWxkZXIsIGNvbHVtbkJ1aWxkZXIpIHtcbiAgICByZXR1cm4gbmV3IHRoaXMuQ29sdW1uQ29tcGlsZXIodGhpcywgdGFibGVCdWlsZGVyLCBjb2x1bW5CdWlsZGVyKVxuICB9LFxuXG4gIFJ1bm5lcixcblxuICBydW5uZXIoY29ubmVjdGlvbikge1xuICAgIHJldHVybiBuZXcgdGhpcy5SdW5uZXIodGhpcywgY29ubmVjdGlvbilcbiAgfSxcblxuICBTcWxTdHJpbmcsXG5cbiAgVHJhbnNhY3Rpb24sXG5cbiAgdHJhbnNhY3Rpb24oY29udGFpbmVyLCBjb25maWcsIG91dGVyVHgpIHtcbiAgICByZXR1cm4gbmV3IHRoaXMuVHJhbnNhY3Rpb24odGhpcywgY29udGFpbmVyLCBjb25maWcsIG91dGVyVHgpXG4gIH0sXG5cbiAgUmF3LFxuXG4gIHJhdygpIHtcbiAgICBjb25zdCByYXcgPSBuZXcgdGhpcy5SYXcodGhpcylcbiAgICByZXR1cm4gcmF3LnNldC5hcHBseShyYXcsIGFyZ3VtZW50cylcbiAgfSxcblxuICBxdWVyeShjb25uZWN0aW9uLCBvYmopIHtcbiAgICBpZiAodHlwZW9mIG9iaiA9PT0gJ3N0cmluZycpIG9iaiA9IHtzcWw6IG9ian1cbiAgICB0aGlzLmVtaXQoJ3F1ZXJ5JywgYXNzaWduKHtfX2tuZXhVaWQ6IGNvbm5lY3Rpb24uX19rbmV4VWlkfSwgb2JqKSlcbiAgICBkZWJ1Z1F1ZXJ5KG9iai5zcWwpXG4gICAgcmV0dXJuIHRoaXMuX3F1ZXJ5LmNhbGwodGhpcywgY29ubmVjdGlvbiwgb2JqKS5jYXRjaCgoZXJyKSA9PiB7XG4gICAgICBlcnIubWVzc2FnZSA9IFNxbFN0cmluZy5mb3JtYXQob2JqLnNxbCwgb2JqLmJpbmRpbmdzKSArICcgLSAnICsgZXJyLm1lc3NhZ2VcbiAgICAgIHRoaXMuZW1pdCgncXVlcnktZXJyb3InLCBlcnIsIGFzc2lnbih7X19rbmV4VWlkOiBjb25uZWN0aW9uLl9fa25leFVpZH0sIG9iaikpXG4gICAgICB0aHJvdyBlcnJcbiAgICB9KVxuICB9LFxuXG4gIHN0cmVhbShjb25uZWN0aW9uLCBvYmosIHN0cmVhbSwgb3B0aW9ucykge1xuICAgIGlmICh0eXBlb2Ygb2JqID09PSAnc3RyaW5nJykgb2JqID0ge3NxbDogb2JqfVxuICAgIHRoaXMuZW1pdCgncXVlcnknLCBhc3NpZ24oe19fa25leFVpZDogY29ubmVjdGlvbi5fX2tuZXhVaWR9LCBvYmopKVxuICAgIGRlYnVnUXVlcnkob2JqLnNxbClcbiAgICByZXR1cm4gdGhpcy5fc3RyZWFtLmNhbGwodGhpcywgY29ubmVjdGlvbiwgb2JqLCBzdHJlYW0sIG9wdGlvbnMpXG4gIH0sXG5cbiAgcHJlcEJpbmRpbmdzKGJpbmRpbmdzKSB7XG4gICAgcmV0dXJuIGJpbmRpbmdzO1xuICB9LFxuXG4gIHdyYXBJZGVudGlmaWVyKHZhbHVlKSB7XG4gICAgcmV0dXJuICh2YWx1ZSAhPT0gJyonID8gYFwiJHt2YWx1ZS5yZXBsYWNlKC9cIi9nLCAnXCJcIicpfVwiYCA6ICcqJylcbiAgfSxcblxuICBpbml0aWFsaXplRHJpdmVyKCkge1xuICAgIHRyeSB7XG4gICAgICB0aGlzLmRyaXZlciA9IHRoaXMuX2RyaXZlcigpXG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgaGVscGVycy5leGl0KGBLbmV4OiBydW5cXG4kIG5wbSBpbnN0YWxsICR7dGhpcy5kcml2ZXJOYW1lfSAtLXNhdmVcXG4ke2Uuc3RhY2t9YClcbiAgICB9XG4gIH0sXG5cbiAgUG9vbDogUG9vbDIsXG5cbiAgaW5pdGlhbGl6ZVBvb2woY29uZmlnKSB7XG4gICAgaWYgKHRoaXMucG9vbCkgdGhpcy5kZXN0cm95KClcbiAgICB0aGlzLnBvb2wgPSBuZXcgdGhpcy5Qb29sKGFzc2lnbih0aGlzLnBvb2xEZWZhdWx0cyhjb25maWcucG9vbCB8fCB7fSksIGNvbmZpZy5wb29sKSlcbiAgICB0aGlzLnBvb2wub24oJ2Vycm9yJywgZnVuY3Rpb24oZXJyKSB7XG4gICAgICBoZWxwZXJzLmVycm9yKGBQb29sMiAtICR7ZXJyfWApXG4gICAgfSlcbiAgICB0aGlzLnBvb2wub24oJ3dhcm4nLCBmdW5jdGlvbihtc2cpIHtcbiAgICAgIGhlbHBlcnMud2FybihgUG9vbDIgLSAke21zZ31gKVxuICAgIH0pXG4gIH0sXG5cbiAgcG9vbERlZmF1bHRzKHBvb2xDb25maWcpIHtcbiAgICBjb25zdCBjbGllbnQgPSB0aGlzXG4gICAgcmV0dXJuIHtcbiAgICAgIG1pbjogMixcbiAgICAgIG1heDogMTAsXG4gICAgICBhY3F1aXJlKGNhbGxiYWNrKSB7XG4gICAgICAgIGNsaWVudC5hY3F1aXJlUmF3Q29ubmVjdGlvbigpXG4gICAgICAgICAgLnRhcChmdW5jdGlvbihjb25uZWN0aW9uKSB7XG4gICAgICAgICAgICBjb25uZWN0aW9uLl9fa25leFVpZCA9IHVuaXF1ZUlkKCdfX2tuZXhVaWQnKVxuICAgICAgICAgICAgaWYgKHBvb2xDb25maWcuYWZ0ZXJDcmVhdGUpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucHJvbWlzaWZ5KHBvb2xDb25maWcuYWZ0ZXJDcmVhdGUpKGNvbm5lY3Rpb24pXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICAgICAuYXNDYWxsYmFjayhjYWxsYmFjaylcbiAgICAgIH0sXG4gICAgICBkaXNwb3NlKGNvbm5lY3Rpb24sIGNhbGxiYWNrKSB7XG4gICAgICAgIGlmIChwb29sQ29uZmlnLmJlZm9yZURlc3Ryb3kpIHtcbiAgICAgICAgICBwb29sQ29uZmlnLmJlZm9yZURlc3Ryb3koY29ubmVjdGlvbiwgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBpZiAoY29ubmVjdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgIGNsaWVudC5kZXN0cm95UmF3Q29ubmVjdGlvbihjb25uZWN0aW9uLCBjYWxsYmFjaylcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KVxuICAgICAgICB9IGVsc2UgaWYgKGNvbm5lY3Rpb24gIT09IHZvaWQgMCkge1xuICAgICAgICAgIGNsaWVudC5kZXN0cm95UmF3Q29ubmVjdGlvbihjb25uZWN0aW9uLCBjYWxsYmFjaylcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHBpbmcocmVzb3VyY2UsIGNhbGxiYWNrKSB7XG4gICAgICAgIHJldHVybiBjbGllbnQucGluZyhyZXNvdXJjZSwgY2FsbGJhY2spO1xuICAgICAgfVxuICAgIH1cbiAgfSxcblxuICAvLyBBY3F1aXJlIGEgY29ubmVjdGlvbiBmcm9tIHRoZSBwb29sLlxuICBhY3F1aXJlQ29ubmVjdGlvbigpIHtcbiAgICBjb25zdCBjbGllbnQgPSB0aGlzXG4gICAgbGV0IHJlcXVlc3QgPSBudWxsXG4gICAgY29uc3QgY29tcGxldGVkID0gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZXIsIHJlamVjdGVyKSB7XG4gICAgICBpZiAoIWNsaWVudC5wb29sKSB7XG4gICAgICAgIHJldHVybiByZWplY3RlcihuZXcgRXJyb3IoJ1RoZXJlIGlzIG5vIHBvb2wgZGVmaW5lZCBvbiB0aGUgY3VycmVudCBjbGllbnQnKSlcbiAgICAgIH1cbiAgICAgIHJlcXVlc3QgPSBjbGllbnQucG9vbC5hY3F1aXJlKGZ1bmN0aW9uKGVyciwgY29ubmVjdGlvbikge1xuICAgICAgICBpZiAoZXJyKSByZXR1cm4gcmVqZWN0ZXIoZXJyKVxuICAgICAgICBkZWJ1ZygnYWNxdWlyZWQgY29ubmVjdGlvbiBmcm9tIHBvb2w6ICVzJywgY29ubmVjdGlvbi5fX2tuZXhVaWQpXG4gICAgICAgIHJlc29sdmVyKGNvbm5lY3Rpb24pXG4gICAgICB9KVxuICAgIH0pXG4gICAgY29uc3QgYWJvcnQgPSBmdW5jdGlvbihyZWFzb24pIHtcbiAgICAgIGlmIChyZXF1ZXN0ICYmICFyZXF1ZXN0LmZ1bGZpbGxlZCkge1xuICAgICAgICByZXF1ZXN0LmFib3J0KHJlYXNvbilcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbXBsZXRlZDogY29tcGxldGVkLFxuICAgICAgYWJvcnQ6IGFib3J0XG4gICAgfVxuICB9LFxuXG4gIC8vIFJlbGVhc2VzIGEgY29ubmVjdGlvbiBiYWNrIHRvIHRoZSBjb25uZWN0aW9uIHBvb2wsXG4gIC8vIHJldHVybmluZyBhIHByb21pc2UgcmVzb2x2ZWQgd2hlbiB0aGUgY29ubmVjdGlvbiBpcyByZWxlYXNlZC5cbiAgcmVsZWFzZUNvbm5lY3Rpb24oY29ubmVjdGlvbikge1xuICAgIGNvbnN0IHsgcG9vbCB9ID0gdGhpc1xuICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlcikge1xuICAgICAgZGVidWcoJ3JlbGVhc2luZyBjb25uZWN0aW9uIHRvIHBvb2w6ICVzJywgY29ubmVjdGlvbi5fX2tuZXhVaWQpXG4gICAgICBwb29sLnJlbGVhc2UoY29ubmVjdGlvbilcbiAgICAgIHJlc29sdmVyKClcbiAgICB9KVxuICB9LFxuXG4gIC8vIERlc3Ryb3kgdGhlIGN1cnJlbnQgY29ubmVjdGlvbiBwb29sIGZvciB0aGUgY2xpZW50LlxuICBkZXN0cm95KGNhbGxiYWNrKSB7XG4gICAgY29uc3QgY2xpZW50ID0gdGhpc1xuICAgIGNvbnN0IHByb21pc2UgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlcikge1xuICAgICAgaWYgKCFjbGllbnQucG9vbCkgcmV0dXJuIHJlc29sdmVyKClcbiAgICAgIGNsaWVudC5wb29sLmVuZChmdW5jdGlvbigpIHtcbiAgICAgICAgY2xpZW50LnBvb2wgPSB1bmRlZmluZWRcbiAgICAgICAgcmVzb2x2ZXIoKVxuICAgICAgfSlcbiAgICB9KVxuICAgIC8vIEFsbG93IGVpdGhlciBhIGNhbGxiYWNrIG9yIHByb21pc2UgaW50ZXJmYWNlIGZvciBkZXN0cnVjdGlvbi5cbiAgICBpZiAodHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBwcm9taXNlLmFzQ2FsbGJhY2soY2FsbGJhY2spXG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBwcm9taXNlXG4gICAgfVxuICB9LFxuXG4gIC8vIFJldHVybiB0aGUgZGF0YWJhc2UgYmVpbmcgdXNlZCBieSB0aGlzIGNsaWVudC5cbiAgZGF0YWJhc2UoKSB7XG4gICAgcmV0dXJuIHRoaXMuY29ubmVjdGlvblNldHRpbmdzLmRhdGFiYXNlXG4gIH0sXG5cbiAgdG9TdHJpbmcoKSB7XG4gICAgcmV0dXJuICdbb2JqZWN0IEtuZXhDbGllbnRdJ1xuICB9XG5cbn0pXG5cbmV4cG9ydCBkZWZhdWx0IENsaWVudFxuIl19