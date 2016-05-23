'use strict';

exports.__esModule = true;

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj['default'] = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _lodash = require('lodash');

var _promise = require('./promise');

var _promise2 = _interopRequireDefault(_promise);

var _helpers = require('./helpers');

var helpers = _interopRequireWildcard(_helpers);

var PassThrough = undefined;

// The "Runner" constructor takes a "builder" (query, schema, or raw)
// and runs through each of the query statements, calling any additional
// "output" method provided alongside the query and bindings.
function Runner(client, builder) {
  this.client = client;
  this.builder = builder;
  this.queries = [];

  // The "connection" object is set on the runner when
  // "run" is called.
  this.connection = void 0;
}

_lodash.assign(Runner.prototype, {

  // "Run" the target, calling "toSQL" on the builder, returning
  // an object or array of queries to run, each of which are run on
  // a single connection.
  run: function run() {
    var runner = this;
    return _promise2['default'].using(this.ensureConnection(), function (connection) {
      runner.connection = connection;

      runner.client.emit('start', runner.builder);
      runner.builder.emit('start', runner.builder);
      var sql = runner.builder.toSQL();

      if (runner.builder._debug) {
        if (runner.client.formattedDebugLog) {
          runner.client.formattedDebugLog(sql);
        } else {
          helpers.debugLog(sql);
        }
      }

      if (_lodash.isArray(sql)) {
        return runner.queryArray(sql);
      }
      return runner.query(sql);
    })

    // If there are any "error" listeners, we fire an error event
    // and then re-throw the error to be eventually handled by
    // the promise chain. Useful if you're wrapping in a custom `Promise`.
    ['catch'](function (err) {
      if (runner.builder._events && runner.builder._events.error) {
        runner.builder.emit('error', err);
      }
      throw err;
    })

    // Fire a single "end" event on the builder when
    // all queries have successfully completed.
    .tap(function () {
      runner.builder.emit('end');
    });
  },

  // Stream the result set, by passing through to the dialect's streaming
  // capabilities. If the options are
  stream: function stream(options, handler) {

    // If we specify stream(handler).then(...
    if (arguments.length === 1) {
      if (typeof options === 'function') {
        handler = options;
        options = {};
      }
    }

    // Determines whether we emit an error or throw here.
    var hasHandler = typeof handler === 'function';

    // Lazy-load the "PassThrough" dependency.
    PassThrough = PassThrough || require('readable-stream').PassThrough;

    var runner = this;
    var stream = new PassThrough({ objectMode: true });
    var promise = _promise2['default'].using(this.ensureConnection(), function (connection) {
      runner.connection = connection;
      var sql = runner.builder.toSQL();
      var err = new Error('The stream may only be used with a single query statement.');
      if (_lodash.isArray(sql)) {
        if (hasHandler) throw err;
        stream.emit('error', err);
      }
      return runner.client.stream(runner.connection, sql, stream, options);
    });

    // If a function is passed to handle the stream, send the stream
    // there and return the promise, otherwise just return the stream
    // and the promise will take care of itsself.
    if (hasHandler) {
      handler(stream);
      return promise;
    }
    return stream;
  },

  // Allow you to pipe the stream to a writable stream.
  pipe: function pipe(writable, options) {
    return this.stream(options).pipe(writable);
  },

  // "Runs" a query, returning a promise. All queries specified by the builder are guaranteed
  // to run in sequence, and on the same connection, especially helpful when schema building
  // and dealing with foreign key constraints, etc.
  query: _promise2['default'].method(function (obj) {
    var _this = this;

    this.builder.emit('query', _lodash.assign({ __knexUid: this.connection.__knexUid }, obj));
    var runner = this;
    var queryPromise = this.client.query(this.connection, obj);

    if (obj.timeout) {
      queryPromise = queryPromise.timeout(obj.timeout);
    }

    return queryPromise.then(function (resp) {
      var processedResponse = _this.client.processResponse(resp, runner);
      _this.builder.emit('query-response', processedResponse, _lodash.assign({ __knexUid: _this.connection.__knexUid }, obj), _this.builder);
      _this.client.emit('query-response', processedResponse, _lodash.assign({ __knexUid: _this.connection.__knexUid }, obj), _this.builder);
      return processedResponse;
    })['catch'](_promise2['default'].TimeoutError, function (error) {
      var timeout = obj.timeout;
      var sql = obj.sql;
      var bindings = obj.bindings;

      throw _lodash.assign(error, {
        message: 'Defined query timeout of ' + timeout + 'ms exceeded when running query.',
        sql: sql, bindings: bindings, timeout: timeout
      });
    })['catch'](function (error) {
      _this.builder.emit('query-error', error, _lodash.assign({ __knexUid: _this.connection.__knexUid }, obj));
      throw error;
    });
  }),

  // In the case of the "schema builder" we call `queryArray`, which runs each
  // of the queries in sequence.
  queryArray: function queryArray(queries) {
    return queries.length === 1 ? this.query(queries[0]) : _promise2['default'].bind(this)['return'](queries).reduce(function (memo, query) {
      return this.query(query).then(function (resp) {
        memo.push(resp);
        return memo;
      });
    }, []);
  },

  // Check whether there's a transaction flag, and that it has a connection.
  ensureConnection: function ensureConnection() {
    var runner = this;
    var acquireConnectionTimeout = runner.client.config.acquireConnectionTimeout || 60000;
    return _promise2['default']['try'](function () {
      return runner.connection || new _promise2['default'](function (resolver, rejecter) {
        var acquireConnection = runner.client.acquireConnection();

        acquireConnection.completed.timeout(acquireConnectionTimeout).then(resolver)['catch'](_promise2['default'].TimeoutError, function (error) {
          var timeoutError = new Error('Knex: Timeout acquiring a connection. The pool is probably full. ' + 'Are you missing a .transacting(trx) call?');
          var additionalErrorInformation = {
            timeoutStack: error.stack
          };

          if (runner.builder) {
            additionalErrorInformation.sql = runner.builder.sql;
            additionalErrorInformation.bindings = runner.builder.bindings;
          }

          _lodash.assign(timeoutError, additionalErrorInformation);

          // Let the pool know that this request for a connection timed out
          acquireConnection.abort('Knex: Timeout acquiring a connection.');

          rejecter(timeoutError);
        })['catch'](rejecter);
      });
    }).disposer(function () {
      if (runner.connection.__knex__disposed) return;
      runner.client.releaseConnection(runner.connection);
    });
  }

});

exports['default'] = Runner;
module.exports = exports['default'];
//# sourceMappingURL=data:application/json;base64,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QUFJLENBQUMsUUFBUSxDQUFDLFNBQ1QsQ0FBQyxxQkFBUSxZQUFZLEVBQUUsVUFBQyxLQUFLLEVBQUs7QUFDdEMsY0FBTSxZQUFZLEdBQUcsSUFBSSxLQUFLLENBQzVCLG1FQUFtRSxHQUNuRSwyQ0FBMkMsQ0FDNUMsQ0FBQztBQUNGLGNBQU0sMEJBQTBCLEdBQUc7QUFDakMsd0JBQVksRUFBRSxLQUFLLENBQUMsS0FBSztXQUMxQixDQUFBOztBQUVELGNBQUcsTUFBTSxDQUFDLE9BQU8sRUFBRTtBQUNqQixzQ0FBMEIsQ0FBQyxHQUFHLEdBQUcsTUFBTSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUM7QUFDcEQsc0NBQTBCLENBQUMsUUFBUSxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDO1dBQy9EOztBQUVELHlCQUFPLFlBQVksRUFBRSwwQkFBMEIsQ0FBQyxDQUFBOzs7QUFHaEQsMkJBQWlCLENBQUMsS0FBSyxDQUFDLHVDQUF1QyxDQUFDLENBQUE7O0FBRWhFLGtCQUFRLENBQUMsWUFBWSxDQUFDLENBQUE7U0FDdkIsQ0FBQyxTQUNJLENBQUMsUUFBUSxDQUFDLENBQUE7T0FDbkIsQ0FBQyxDQUFBO0tBQ0gsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxZQUFXO0FBQ3JCLFVBQUksTUFBTSxDQUFDLFVBQVUsQ0FBQyxnQkFBZ0IsRUFBRSxPQUFNO0FBQzlDLFlBQU0sQ0FBQyxNQUFNLENBQUMsaUJBQWlCLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFBO0tBQ25ELENBQUMsQ0FBQTtHQUNIOztDQUVGLENBQUMsQ0FBQTs7cUJBRWEsTUFBTSIsImZpbGUiOiJydW5uZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBhc3NpZ24sIGlzQXJyYXkgfSBmcm9tICdsb2Rhc2gnXG5pbXBvcnQgUHJvbWlzZSBmcm9tICcuL3Byb21pc2UnO1xuaW1wb3J0ICogYXMgaGVscGVycyBmcm9tICcuL2hlbHBlcnMnO1xuXG5sZXQgUGFzc1Rocm91Z2g7XG5cbi8vIFRoZSBcIlJ1bm5lclwiIGNvbnN0cnVjdG9yIHRha2VzIGEgXCJidWlsZGVyXCIgKHF1ZXJ5LCBzY2hlbWEsIG9yIHJhdylcbi8vIGFuZCBydW5zIHRocm91Z2ggZWFjaCBvZiB0aGUgcXVlcnkgc3RhdGVtZW50cywgY2FsbGluZyBhbnkgYWRkaXRpb25hbFxuLy8gXCJvdXRwdXRcIiBtZXRob2QgcHJvdmlkZWQgYWxvbmdzaWRlIHRoZSBxdWVyeSBhbmQgYmluZGluZ3MuXG5mdW5jdGlvbiBSdW5uZXIoY2xpZW50LCBidWlsZGVyKSB7XG4gIHRoaXMuY2xpZW50ID0gY2xpZW50XG4gIHRoaXMuYnVpbGRlciA9IGJ1aWxkZXJcbiAgdGhpcy5xdWVyaWVzID0gW11cblxuICAvLyBUaGUgXCJjb25uZWN0aW9uXCIgb2JqZWN0IGlzIHNldCBvbiB0aGUgcnVubmVyIHdoZW5cbiAgLy8gXCJydW5cIiBpcyBjYWxsZWQuXG4gIHRoaXMuY29ubmVjdGlvbiA9IHZvaWQgMFxufVxuXG5hc3NpZ24oUnVubmVyLnByb3RvdHlwZSwge1xuXG4gIC8vIFwiUnVuXCIgdGhlIHRhcmdldCwgY2FsbGluZyBcInRvU1FMXCIgb24gdGhlIGJ1aWxkZXIsIHJldHVybmluZ1xuICAvLyBhbiBvYmplY3Qgb3IgYXJyYXkgb2YgcXVlcmllcyB0byBydW4sIGVhY2ggb2Ygd2hpY2ggYXJlIHJ1biBvblxuICAvLyBhIHNpbmdsZSBjb25uZWN0aW9uLlxuICBydW4oKSB7XG4gICAgY29uc3QgcnVubmVyID0gdGhpc1xuICAgIHJldHVybiBQcm9taXNlLnVzaW5nKHRoaXMuZW5zdXJlQ29ubmVjdGlvbigpLCBmdW5jdGlvbihjb25uZWN0aW9uKSB7XG4gICAgICBydW5uZXIuY29ubmVjdGlvbiA9IGNvbm5lY3Rpb247XG5cbiAgICAgIHJ1bm5lci5jbGllbnQuZW1pdCgnc3RhcnQnLCBydW5uZXIuYnVpbGRlcilcbiAgICAgIHJ1bm5lci5idWlsZGVyLmVtaXQoJ3N0YXJ0JywgcnVubmVyLmJ1aWxkZXIpXG4gICAgICBjb25zdCBzcWwgPSBydW5uZXIuYnVpbGRlci50b1NRTCgpO1xuXG4gICAgICBpZiAocnVubmVyLmJ1aWxkZXIuX2RlYnVnKSB7XG4gICAgICAgIGlmIChydW5uZXIuY2xpZW50LmZvcm1hdHRlZERlYnVnTG9nKSB7XG4gICAgICAgICAgcnVubmVyLmNsaWVudC5mb3JtYXR0ZWREZWJ1Z0xvZyhzcWwpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGhlbHBlcnMuZGVidWdMb2coc3FsKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChpc0FycmF5KHNxbCkpIHtcbiAgICAgICAgcmV0dXJuIHJ1bm5lci5xdWVyeUFycmF5KHNxbCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gcnVubmVyLnF1ZXJ5KHNxbCk7XG5cbiAgICB9KVxuXG4gICAgLy8gSWYgdGhlcmUgYXJlIGFueSBcImVycm9yXCIgbGlzdGVuZXJzLCB3ZSBmaXJlIGFuIGVycm9yIGV2ZW50XG4gICAgLy8gYW5kIHRoZW4gcmUtdGhyb3cgdGhlIGVycm9yIHRvIGJlIGV2ZW50dWFsbHkgaGFuZGxlZCBieVxuICAgIC8vIHRoZSBwcm9taXNlIGNoYWluLiBVc2VmdWwgaWYgeW91J3JlIHdyYXBwaW5nIGluIGEgY3VzdG9tIGBQcm9taXNlYC5cbiAgICAuY2F0Y2goZnVuY3Rpb24oZXJyKSB7XG4gICAgICBpZiAocnVubmVyLmJ1aWxkZXIuX2V2ZW50cyAmJiBydW5uZXIuYnVpbGRlci5fZXZlbnRzLmVycm9yKSB7XG4gICAgICAgIHJ1bm5lci5idWlsZGVyLmVtaXQoJ2Vycm9yJywgZXJyKTtcbiAgICAgIH1cbiAgICAgIHRocm93IGVycjtcbiAgICB9KVxuXG4gICAgLy8gRmlyZSBhIHNpbmdsZSBcImVuZFwiIGV2ZW50IG9uIHRoZSBidWlsZGVyIHdoZW5cbiAgICAvLyBhbGwgcXVlcmllcyBoYXZlIHN1Y2Nlc3NmdWxseSBjb21wbGV0ZWQuXG4gICAgLnRhcChmdW5jdGlvbigpIHtcbiAgICAgIHJ1bm5lci5idWlsZGVyLmVtaXQoJ2VuZCcpO1xuICAgIH0pXG5cbiAgfSxcblxuICAvLyBTdHJlYW0gdGhlIHJlc3VsdCBzZXQsIGJ5IHBhc3NpbmcgdGhyb3VnaCB0byB0aGUgZGlhbGVjdCdzIHN0cmVhbWluZ1xuICAvLyBjYXBhYmlsaXRpZXMuIElmIHRoZSBvcHRpb25zIGFyZVxuICBzdHJlYW0ob3B0aW9ucywgaGFuZGxlcikge1xuXG4gICAgLy8gSWYgd2Ugc3BlY2lmeSBzdHJlYW0oaGFuZGxlcikudGhlbiguLi5cbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgaWYgKHR5cGVvZiBvcHRpb25zID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGhhbmRsZXIgPSBvcHRpb25zO1xuICAgICAgICBvcHRpb25zID0ge307XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gRGV0ZXJtaW5lcyB3aGV0aGVyIHdlIGVtaXQgYW4gZXJyb3Igb3IgdGhyb3cgaGVyZS5cbiAgICBjb25zdCBoYXNIYW5kbGVyID0gdHlwZW9mIGhhbmRsZXIgPT09ICdmdW5jdGlvbic7XG5cbiAgICAvLyBMYXp5LWxvYWQgdGhlIFwiUGFzc1Rocm91Z2hcIiBkZXBlbmRlbmN5LlxuICAgIFBhc3NUaHJvdWdoID0gUGFzc1Rocm91Z2ggfHwgcmVxdWlyZSgncmVhZGFibGUtc3RyZWFtJykuUGFzc1Rocm91Z2g7XG5cbiAgICBjb25zdCBydW5uZXIgPSB0aGlzO1xuICAgIGNvbnN0IHN0cmVhbSA9IG5ldyBQYXNzVGhyb3VnaCh7b2JqZWN0TW9kZTogdHJ1ZX0pO1xuICAgIGNvbnN0IHByb21pc2UgPSBQcm9taXNlLnVzaW5nKHRoaXMuZW5zdXJlQ29ubmVjdGlvbigpLCBmdW5jdGlvbihjb25uZWN0aW9uKSB7XG4gICAgICBydW5uZXIuY29ubmVjdGlvbiA9IGNvbm5lY3Rpb247XG4gICAgICBjb25zdCBzcWwgPSBydW5uZXIuYnVpbGRlci50b1NRTCgpXG4gICAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoJ1RoZSBzdHJlYW0gbWF5IG9ubHkgYmUgdXNlZCB3aXRoIGEgc2luZ2xlIHF1ZXJ5IHN0YXRlbWVudC4nKTtcbiAgICAgIGlmIChpc0FycmF5KHNxbCkpIHtcbiAgICAgICAgaWYgKGhhc0hhbmRsZXIpIHRocm93IGVycjtcbiAgICAgICAgc3RyZWFtLmVtaXQoJ2Vycm9yJywgZXJyKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBydW5uZXIuY2xpZW50LnN0cmVhbShydW5uZXIuY29ubmVjdGlvbiwgc3FsLCBzdHJlYW0sIG9wdGlvbnMpO1xuICAgIH0pXG5cbiAgICAvLyBJZiBhIGZ1bmN0aW9uIGlzIHBhc3NlZCB0byBoYW5kbGUgdGhlIHN0cmVhbSwgc2VuZCB0aGUgc3RyZWFtXG4gICAgLy8gdGhlcmUgYW5kIHJldHVybiB0aGUgcHJvbWlzZSwgb3RoZXJ3aXNlIGp1c3QgcmV0dXJuIHRoZSBzdHJlYW1cbiAgICAvLyBhbmQgdGhlIHByb21pc2Ugd2lsbCB0YWtlIGNhcmUgb2YgaXRzc2VsZi5cbiAgICBpZiAoaGFzSGFuZGxlcikge1xuICAgICAgaGFuZGxlcihzdHJlYW0pO1xuICAgICAgcmV0dXJuIHByb21pc2U7XG4gICAgfVxuICAgIHJldHVybiBzdHJlYW07XG4gIH0sXG5cbiAgLy8gQWxsb3cgeW91IHRvIHBpcGUgdGhlIHN0cmVhbSB0byBhIHdyaXRhYmxlIHN0cmVhbS5cbiAgcGlwZSh3cml0YWJsZSwgb3B0aW9ucykge1xuICAgIHJldHVybiB0aGlzLnN0cmVhbShvcHRpb25zKS5waXBlKHdyaXRhYmxlKTtcbiAgfSxcblxuICAvLyBcIlJ1bnNcIiBhIHF1ZXJ5LCByZXR1cm5pbmcgYSBwcm9taXNlLiBBbGwgcXVlcmllcyBzcGVjaWZpZWQgYnkgdGhlIGJ1aWxkZXIgYXJlIGd1YXJhbnRlZWRcbiAgLy8gdG8gcnVuIGluIHNlcXVlbmNlLCBhbmQgb24gdGhlIHNhbWUgY29ubmVjdGlvbiwgZXNwZWNpYWxseSBoZWxwZnVsIHdoZW4gc2NoZW1hIGJ1aWxkaW5nXG4gIC8vIGFuZCBkZWFsaW5nIHdpdGggZm9yZWlnbiBrZXkgY29uc3RyYWludHMsIGV0Yy5cbiAgcXVlcnk6IFByb21pc2UubWV0aG9kKGZ1bmN0aW9uKG9iaikge1xuICAgIHRoaXMuYnVpbGRlci5lbWl0KCdxdWVyeScsIGFzc2lnbih7X19rbmV4VWlkOiB0aGlzLmNvbm5lY3Rpb24uX19rbmV4VWlkfSwgb2JqKSlcbiAgICBjb25zdCBydW5uZXIgPSB0aGlzXG4gICAgbGV0IHF1ZXJ5UHJvbWlzZSA9IHRoaXMuY2xpZW50LnF1ZXJ5KHRoaXMuY29ubmVjdGlvbiwgb2JqKVxuXG4gICAgaWYob2JqLnRpbWVvdXQpIHtcbiAgICAgIHF1ZXJ5UHJvbWlzZSA9IHF1ZXJ5UHJvbWlzZS50aW1lb3V0KG9iai50aW1lb3V0KVxuICAgIH1cblxuICAgIHJldHVybiBxdWVyeVByb21pc2VcbiAgICAgIC50aGVuKChyZXNwKSA9PiB7XG4gICAgICAgIGNvbnN0IHByb2Nlc3NlZFJlc3BvbnNlID0gdGhpcy5jbGllbnQucHJvY2Vzc1Jlc3BvbnNlKHJlc3AsIHJ1bm5lcik7XG4gICAgICAgIHRoaXMuYnVpbGRlci5lbWl0KFxuICAgICAgICAgICdxdWVyeS1yZXNwb25zZScsXG4gICAgICAgICAgcHJvY2Vzc2VkUmVzcG9uc2UsXG4gICAgICAgICAgYXNzaWduKHtfX2tuZXhVaWQ6IHRoaXMuY29ubmVjdGlvbi5fX2tuZXhVaWR9LCBvYmopLFxuICAgICAgICAgIHRoaXMuYnVpbGRlclxuICAgICAgICApO1xuICAgICAgICB0aGlzLmNsaWVudC5lbWl0KFxuICAgICAgICAgICdxdWVyeS1yZXNwb25zZScsXG4gICAgICAgICAgcHJvY2Vzc2VkUmVzcG9uc2UsXG4gICAgICAgICAgYXNzaWduKHtfX2tuZXhVaWQ6IHRoaXMuY29ubmVjdGlvbi5fX2tuZXhVaWR9LCBvYmopLFxuICAgICAgICAgIHRoaXMuYnVpbGRlclxuICAgICAgICApO1xuICAgICAgICByZXR1cm4gcHJvY2Vzc2VkUmVzcG9uc2U7XG4gICAgICB9KS5jYXRjaChQcm9taXNlLlRpbWVvdXRFcnJvciwgZXJyb3IgPT4ge1xuICAgICAgICBjb25zdCB7IHRpbWVvdXQsIHNxbCwgYmluZGluZ3MgfSA9IG9iajtcbiAgICAgICAgdGhyb3cgYXNzaWduKGVycm9yLCB7XG4gICAgICAgICAgbWVzc2FnZTogYERlZmluZWQgcXVlcnkgdGltZW91dCBvZiAke3RpbWVvdXR9bXMgZXhjZWVkZWQgd2hlbiBydW5uaW5nIHF1ZXJ5LmAsXG4gICAgICAgICAgc3FsLCBiaW5kaW5ncywgdGltZW91dFxuICAgICAgICB9KTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgIHRoaXMuYnVpbGRlci5lbWl0KCdxdWVyeS1lcnJvcicsIGVycm9yLCBhc3NpZ24oe19fa25leFVpZDogdGhpcy5jb25uZWN0aW9uLl9fa25leFVpZH0sIG9iaikpXG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSk7XG4gIH0pLFxuXG4gIC8vIEluIHRoZSBjYXNlIG9mIHRoZSBcInNjaGVtYSBidWlsZGVyXCIgd2UgY2FsbCBgcXVlcnlBcnJheWAsIHdoaWNoIHJ1bnMgZWFjaFxuICAvLyBvZiB0aGUgcXVlcmllcyBpbiBzZXF1ZW5jZS5cbiAgcXVlcnlBcnJheShxdWVyaWVzKSB7XG4gICAgcmV0dXJuIHF1ZXJpZXMubGVuZ3RoID09PSAxID8gdGhpcy5xdWVyeShxdWVyaWVzWzBdKSA6IFByb21pc2UuYmluZCh0aGlzKVxuICAgICAgLnJldHVybihxdWVyaWVzKVxuICAgICAgLnJlZHVjZShmdW5jdGlvbihtZW1vLCBxdWVyeSkge1xuICAgICAgICByZXR1cm4gdGhpcy5xdWVyeShxdWVyeSkudGhlbihmdW5jdGlvbihyZXNwKSB7XG4gICAgICAgICAgbWVtby5wdXNoKHJlc3ApXG4gICAgICAgICAgcmV0dXJuIG1lbW87XG4gICAgICAgIH0pO1xuICAgICAgfSwgW10pXG4gIH0sXG5cbiAgLy8gQ2hlY2sgd2hldGhlciB0aGVyZSdzIGEgdHJhbnNhY3Rpb24gZmxhZywgYW5kIHRoYXQgaXQgaGFzIGEgY29ubmVjdGlvbi5cbiAgZW5zdXJlQ29ubmVjdGlvbigpIHtcbiAgICBjb25zdCBydW5uZXIgPSB0aGlzXG4gICAgY29uc3QgYWNxdWlyZUNvbm5lY3Rpb25UaW1lb3V0ID0gcnVubmVyLmNsaWVudC5jb25maWcuYWNxdWlyZUNvbm5lY3Rpb25UaW1lb3V0IHx8IDYwMDAwO1xuICAgIHJldHVybiBQcm9taXNlLnRyeSgoKSA9PiB7XG4gICAgICByZXR1cm4gcnVubmVyLmNvbm5lY3Rpb24gfHwgbmV3IFByb21pc2UoKHJlc29sdmVyLCByZWplY3RlcikgPT4ge1xuICAgICAgICBjb25zdCBhY3F1aXJlQ29ubmVjdGlvbiA9IHJ1bm5lci5jbGllbnQuYWNxdWlyZUNvbm5lY3Rpb24oKTtcblxuICAgICAgICBhY3F1aXJlQ29ubmVjdGlvbi5jb21wbGV0ZWRcbiAgICAgICAgICAudGltZW91dChhY3F1aXJlQ29ubmVjdGlvblRpbWVvdXQpXG4gICAgICAgICAgLnRoZW4ocmVzb2x2ZXIpXG4gICAgICAgICAgLmNhdGNoKFByb21pc2UuVGltZW91dEVycm9yLCAoZXJyb3IpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHRpbWVvdXRFcnJvciA9IG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgJ0tuZXg6IFRpbWVvdXQgYWNxdWlyaW5nIGEgY29ubmVjdGlvbi4gVGhlIHBvb2wgaXMgcHJvYmFibHkgZnVsbC4gJyArXG4gICAgICAgICAgICAgICdBcmUgeW91IG1pc3NpbmcgYSAudHJhbnNhY3RpbmcodHJ4KSBjYWxsPydcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBjb25zdCBhZGRpdGlvbmFsRXJyb3JJbmZvcm1hdGlvbiA9IHtcbiAgICAgICAgICAgICAgdGltZW91dFN0YWNrOiBlcnJvci5zdGFja1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZihydW5uZXIuYnVpbGRlcikge1xuICAgICAgICAgICAgICBhZGRpdGlvbmFsRXJyb3JJbmZvcm1hdGlvbi5zcWwgPSBydW5uZXIuYnVpbGRlci5zcWw7XG4gICAgICAgICAgICAgIGFkZGl0aW9uYWxFcnJvckluZm9ybWF0aW9uLmJpbmRpbmdzID0gcnVubmVyLmJ1aWxkZXIuYmluZGluZ3M7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGFzc2lnbih0aW1lb3V0RXJyb3IsIGFkZGl0aW9uYWxFcnJvckluZm9ybWF0aW9uKVxuXG4gICAgICAgICAgICAvLyBMZXQgdGhlIHBvb2wga25vdyB0aGF0IHRoaXMgcmVxdWVzdCBmb3IgYSBjb25uZWN0aW9uIHRpbWVkIG91dFxuICAgICAgICAgICAgYWNxdWlyZUNvbm5lY3Rpb24uYWJvcnQoJ0tuZXg6IFRpbWVvdXQgYWNxdWlyaW5nIGEgY29ubmVjdGlvbi4nKVxuXG4gICAgICAgICAgICByZWplY3Rlcih0aW1lb3V0RXJyb3IpXG4gICAgICAgICAgfSlcbiAgICAgICAgICAuY2F0Y2gocmVqZWN0ZXIpXG4gICAgICB9KVxuICAgIH0pLmRpc3Bvc2VyKGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKHJ1bm5lci5jb25uZWN0aW9uLl9fa25leF9fZGlzcG9zZWQpIHJldHVyblxuICAgICAgcnVubmVyLmNsaWVudC5yZWxlYXNlQ29ubmVjdGlvbihydW5uZXIuY29ubmVjdGlvbilcbiAgICB9KVxuICB9XG5cbn0pXG5cbmV4cG9ydCBkZWZhdWx0IFJ1bm5lcjtcbiJdfQ==