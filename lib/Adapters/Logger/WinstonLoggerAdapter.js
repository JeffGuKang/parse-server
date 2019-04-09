"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.WinstonLoggerAdapter = void 0;

var _LoggerAdapter = require("./LoggerAdapter");

var _WinstonLogger = require("./WinstonLogger");

const MILLISECONDS_IN_A_DAY = 24 * 60 * 60 * 1000;

class WinstonLoggerAdapter extends _LoggerAdapter.LoggerAdapter {
  constructor(options) {
    super();

    if (options) {
      (0, _WinstonLogger.configureLogger)(options);
    }
  }

  log() {
    return _WinstonLogger.logger.log.apply(_WinstonLogger.logger, arguments);
  }

  addTransport(transport) {
    // Note that this is calling addTransport
    // from logger.  See import - confusing.
    // but this is not recursive.
    (0, _WinstonLogger.addTransport)(transport);
  } // custom query as winston is currently limited


  query(options, callback = () => {}) {
    if (!options) {
      options = {};
    } // defaults to 7 days prior


    const from = options.from || new Date(Date.now() - 7 * MILLISECONDS_IN_A_DAY);
    const until = options.until || new Date();
    const limit = options.size || 10;
    const order = options.order || 'desc';
    const level = options.level || 'info';
    const queryOptions = {
      from,
      until,
      limit,
      order
    };
    return new Promise((resolve, reject) => {
      _WinstonLogger.logger.query(queryOptions, (err, res) => {
        if (err) {
          callback(err);
          return reject(err);
        }

        if (level == 'error') {
          callback(res['parse-server-error']);
          resolve(res['parse-server-error']);
        } else {
          callback(res['parse-server']);
          resolve(res['parse-server']);
        }
      });
    });
  }

}

exports.WinstonLoggerAdapter = WinstonLoggerAdapter;
var _default = WinstonLoggerAdapter;
exports.default = _default;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9BZGFwdGVycy9Mb2dnZXIvV2luc3RvbkxvZ2dlckFkYXB0ZXIuanMiXSwibmFtZXMiOlsiTUlMTElTRUNPTkRTX0lOX0FfREFZIiwiV2luc3RvbkxvZ2dlckFkYXB0ZXIiLCJMb2dnZXJBZGFwdGVyIiwiY29uc3RydWN0b3IiLCJvcHRpb25zIiwibG9nIiwibG9nZ2VyIiwiYXBwbHkiLCJhcmd1bWVudHMiLCJhZGRUcmFuc3BvcnQiLCJ0cmFuc3BvcnQiLCJxdWVyeSIsImNhbGxiYWNrIiwiZnJvbSIsIkRhdGUiLCJub3ciLCJ1bnRpbCIsImxpbWl0Iiwic2l6ZSIsIm9yZGVyIiwibGV2ZWwiLCJxdWVyeU9wdGlvbnMiLCJQcm9taXNlIiwicmVzb2x2ZSIsInJlamVjdCIsImVyciIsInJlcyJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBOztBQUNBOztBQUVBLE1BQU1BLHFCQUFxQixHQUFHLEtBQUssRUFBTCxHQUFVLEVBQVYsR0FBZSxJQUE3Qzs7QUFFTyxNQUFNQyxvQkFBTixTQUFtQ0MsNEJBQW5DLENBQWlEO0FBQ3REQyxFQUFBQSxXQUFXLENBQUNDLE9BQUQsRUFBVTtBQUNuQjs7QUFDQSxRQUFJQSxPQUFKLEVBQWE7QUFDWCwwQ0FBZ0JBLE9BQWhCO0FBQ0Q7QUFDRjs7QUFFREMsRUFBQUEsR0FBRyxHQUFHO0FBQ0osV0FBT0Msc0JBQU9ELEdBQVAsQ0FBV0UsS0FBWCxDQUFpQkQscUJBQWpCLEVBQXlCRSxTQUF6QixDQUFQO0FBQ0Q7O0FBRURDLEVBQUFBLFlBQVksQ0FBQ0MsU0FBRCxFQUFZO0FBQ3RCO0FBQ0E7QUFDQTtBQUNBLHFDQUFhQSxTQUFiO0FBQ0QsR0FqQnFELENBbUJ0RDs7O0FBQ0FDLEVBQUFBLEtBQUssQ0FBQ1AsT0FBRCxFQUFVUSxRQUFRLEdBQUcsTUFBTSxDQUFFLENBQTdCLEVBQStCO0FBQ2xDLFFBQUksQ0FBQ1IsT0FBTCxFQUFjO0FBQ1pBLE1BQUFBLE9BQU8sR0FBRyxFQUFWO0FBQ0QsS0FIaUMsQ0FJbEM7OztBQUNBLFVBQU1TLElBQUksR0FDUlQsT0FBTyxDQUFDUyxJQUFSLElBQWdCLElBQUlDLElBQUosQ0FBU0EsSUFBSSxDQUFDQyxHQUFMLEtBQWEsSUFBSWYscUJBQTFCLENBRGxCO0FBRUEsVUFBTWdCLEtBQUssR0FBR1osT0FBTyxDQUFDWSxLQUFSLElBQWlCLElBQUlGLElBQUosRUFBL0I7QUFDQSxVQUFNRyxLQUFLLEdBQUdiLE9BQU8sQ0FBQ2MsSUFBUixJQUFnQixFQUE5QjtBQUNBLFVBQU1DLEtBQUssR0FBR2YsT0FBTyxDQUFDZSxLQUFSLElBQWlCLE1BQS9CO0FBQ0EsVUFBTUMsS0FBSyxHQUFHaEIsT0FBTyxDQUFDZ0IsS0FBUixJQUFpQixNQUEvQjtBQUVBLFVBQU1DLFlBQVksR0FBRztBQUNuQlIsTUFBQUEsSUFEbUI7QUFFbkJHLE1BQUFBLEtBRm1CO0FBR25CQyxNQUFBQSxLQUhtQjtBQUluQkUsTUFBQUE7QUFKbUIsS0FBckI7QUFPQSxXQUFPLElBQUlHLE9BQUosQ0FBWSxDQUFDQyxPQUFELEVBQVVDLE1BQVYsS0FBcUI7QUFDdENsQiw0QkFBT0ssS0FBUCxDQUFhVSxZQUFiLEVBQTJCLENBQUNJLEdBQUQsRUFBTUMsR0FBTixLQUFjO0FBQ3ZDLFlBQUlELEdBQUosRUFBUztBQUNQYixVQUFBQSxRQUFRLENBQUNhLEdBQUQsQ0FBUjtBQUNBLGlCQUFPRCxNQUFNLENBQUNDLEdBQUQsQ0FBYjtBQUNEOztBQUNELFlBQUlMLEtBQUssSUFBSSxPQUFiLEVBQXNCO0FBQ3BCUixVQUFBQSxRQUFRLENBQUNjLEdBQUcsQ0FBQyxvQkFBRCxDQUFKLENBQVI7QUFDQUgsVUFBQUEsT0FBTyxDQUFDRyxHQUFHLENBQUMsb0JBQUQsQ0FBSixDQUFQO0FBQ0QsU0FIRCxNQUdPO0FBQ0xkLFVBQUFBLFFBQVEsQ0FBQ2MsR0FBRyxDQUFDLGNBQUQsQ0FBSixDQUFSO0FBQ0FILFVBQUFBLE9BQU8sQ0FBQ0csR0FBRyxDQUFDLGNBQUQsQ0FBSixDQUFQO0FBQ0Q7QUFDRixPQVpEO0FBYUQsS0FkTSxDQUFQO0FBZUQ7O0FBdERxRDs7O2VBeUR6Q3pCLG9CIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgTG9nZ2VyQWRhcHRlciB9IGZyb20gJy4vTG9nZ2VyQWRhcHRlcic7XG5pbXBvcnQgeyBsb2dnZXIsIGFkZFRyYW5zcG9ydCwgY29uZmlndXJlTG9nZ2VyIH0gZnJvbSAnLi9XaW5zdG9uTG9nZ2VyJztcblxuY29uc3QgTUlMTElTRUNPTkRTX0lOX0FfREFZID0gMjQgKiA2MCAqIDYwICogMTAwMDtcblxuZXhwb3J0IGNsYXNzIFdpbnN0b25Mb2dnZXJBZGFwdGVyIGV4dGVuZHMgTG9nZ2VyQWRhcHRlciB7XG4gIGNvbnN0cnVjdG9yKG9wdGlvbnMpIHtcbiAgICBzdXBlcigpO1xuICAgIGlmIChvcHRpb25zKSB7XG4gICAgICBjb25maWd1cmVMb2dnZXIob3B0aW9ucyk7XG4gICAgfVxuICB9XG5cbiAgbG9nKCkge1xuICAgIHJldHVybiBsb2dnZXIubG9nLmFwcGx5KGxvZ2dlciwgYXJndW1lbnRzKTtcbiAgfVxuXG4gIGFkZFRyYW5zcG9ydCh0cmFuc3BvcnQpIHtcbiAgICAvLyBOb3RlIHRoYXQgdGhpcyBpcyBjYWxsaW5nIGFkZFRyYW5zcG9ydFxuICAgIC8vIGZyb20gbG9nZ2VyLiAgU2VlIGltcG9ydCAtIGNvbmZ1c2luZy5cbiAgICAvLyBidXQgdGhpcyBpcyBub3QgcmVjdXJzaXZlLlxuICAgIGFkZFRyYW5zcG9ydCh0cmFuc3BvcnQpO1xuICB9XG5cbiAgLy8gY3VzdG9tIHF1ZXJ5IGFzIHdpbnN0b24gaXMgY3VycmVudGx5IGxpbWl0ZWRcbiAgcXVlcnkob3B0aW9ucywgY2FsbGJhY2sgPSAoKSA9PiB7fSkge1xuICAgIGlmICghb3B0aW9ucykge1xuICAgICAgb3B0aW9ucyA9IHt9O1xuICAgIH1cbiAgICAvLyBkZWZhdWx0cyB0byA3IGRheXMgcHJpb3JcbiAgICBjb25zdCBmcm9tID1cbiAgICAgIG9wdGlvbnMuZnJvbSB8fCBuZXcgRGF0ZShEYXRlLm5vdygpIC0gNyAqIE1JTExJU0VDT05EU19JTl9BX0RBWSk7XG4gICAgY29uc3QgdW50aWwgPSBvcHRpb25zLnVudGlsIHx8IG5ldyBEYXRlKCk7XG4gICAgY29uc3QgbGltaXQgPSBvcHRpb25zLnNpemUgfHwgMTA7XG4gICAgY29uc3Qgb3JkZXIgPSBvcHRpb25zLm9yZGVyIHx8ICdkZXNjJztcbiAgICBjb25zdCBsZXZlbCA9IG9wdGlvbnMubGV2ZWwgfHwgJ2luZm8nO1xuXG4gICAgY29uc3QgcXVlcnlPcHRpb25zID0ge1xuICAgICAgZnJvbSxcbiAgICAgIHVudGlsLFxuICAgICAgbGltaXQsXG4gICAgICBvcmRlcixcbiAgICB9O1xuXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGxvZ2dlci5xdWVyeShxdWVyeU9wdGlvbnMsIChlcnIsIHJlcykgPT4ge1xuICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgICAgICByZXR1cm4gcmVqZWN0KGVycik7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGxldmVsID09ICdlcnJvcicpIHtcbiAgICAgICAgICBjYWxsYmFjayhyZXNbJ3BhcnNlLXNlcnZlci1lcnJvciddKTtcbiAgICAgICAgICByZXNvbHZlKHJlc1sncGFyc2Utc2VydmVyLWVycm9yJ10pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNhbGxiYWNrKHJlc1sncGFyc2Utc2VydmVyJ10pO1xuICAgICAgICAgIHJlc29sdmUocmVzWydwYXJzZS1zZXJ2ZXInXSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IFdpbnN0b25Mb2dnZXJBZGFwdGVyO1xuIl19