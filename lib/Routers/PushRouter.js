"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.PushRouter = void 0;

var _PromiseRouter = _interopRequireDefault(require("../PromiseRouter"));

var middleware = _interopRequireWildcard(require("../middlewares"));

var _node = require("parse/node");

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = Object.defineProperty && Object.getOwnPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : {}; if (desc.get || desc.set) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class PushRouter extends _PromiseRouter.default {
  mountRoutes() {
    this.route('POST', '/push', middleware.promiseEnforceMasterKeyAccess, PushRouter.handlePOST);
  }

  static handlePOST(req) {
    if (req.auth.isReadOnly) {
      throw new _node.Parse.Error(_node.Parse.Error.OPERATION_FORBIDDEN, "read-only masterKey isn't allowed to send push notifications.");
    }

    const pushController = req.config.pushController;

    if (!pushController) {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, 'Push controller is not set');
    }

    const where = PushRouter.getQueryCondition(req);
    let resolve;
    const promise = new Promise(_resolve => {
      resolve = _resolve;
    });
    let pushStatusId;
    pushController.sendPush(req.body, where, req.config, req.auth, objectId => {
      pushStatusId = objectId;
      resolve({
        headers: {
          'X-Parse-Push-Status-Id': pushStatusId
        },
        response: {
          result: true
        }
      });
    }).catch(err => {
      req.config.loggerController.error(`_PushStatus ${pushStatusId}: error while sending push`, err);
    });
    return promise;
  }
  /**
   * Get query condition from the request body.
   * @param {Object} req A request object
   * @returns {Object} The query condition, the where field in a query api call
   */


  static getQueryCondition(req) {
    const body = req.body || {};
    const hasWhere = typeof body.where !== 'undefined';
    const hasChannels = typeof body.channels !== 'undefined';
    let where;

    if (hasWhere && hasChannels) {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, 'Channels and query can not be set at the same time.');
    } else if (hasWhere) {
      where = body.where;
    } else if (hasChannels) {
      where = {
        channels: {
          $in: body.channels
        }
      };
    } else {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, 'Sending a push requires either "channels" or a "where" query.');
    }

    return where;
  }

}

exports.PushRouter = PushRouter;
var _default = PushRouter;
exports.default = _default;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL1B1c2hSb3V0ZXIuanMiXSwibmFtZXMiOlsiUHVzaFJvdXRlciIsIlByb21pc2VSb3V0ZXIiLCJtb3VudFJvdXRlcyIsInJvdXRlIiwibWlkZGxld2FyZSIsInByb21pc2VFbmZvcmNlTWFzdGVyS2V5QWNjZXNzIiwiaGFuZGxlUE9TVCIsInJlcSIsImF1dGgiLCJpc1JlYWRPbmx5IiwiUGFyc2UiLCJFcnJvciIsIk9QRVJBVElPTl9GT1JCSURERU4iLCJwdXNoQ29udHJvbGxlciIsImNvbmZpZyIsIlBVU0hfTUlTQ09ORklHVVJFRCIsIndoZXJlIiwiZ2V0UXVlcnlDb25kaXRpb24iLCJyZXNvbHZlIiwicHJvbWlzZSIsIlByb21pc2UiLCJfcmVzb2x2ZSIsInB1c2hTdGF0dXNJZCIsInNlbmRQdXNoIiwiYm9keSIsIm9iamVjdElkIiwiaGVhZGVycyIsInJlc3BvbnNlIiwicmVzdWx0IiwiY2F0Y2giLCJlcnIiLCJsb2dnZXJDb250cm9sbGVyIiwiZXJyb3IiLCJoYXNXaGVyZSIsImhhc0NoYW5uZWxzIiwiY2hhbm5lbHMiLCIkaW4iXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBQTs7QUFDQTs7QUFDQTs7Ozs7O0FBRU8sTUFBTUEsVUFBTixTQUF5QkMsc0JBQXpCLENBQXVDO0FBQzVDQyxFQUFBQSxXQUFXLEdBQUc7QUFDWixTQUFLQyxLQUFMLENBQ0UsTUFERixFQUVFLE9BRkYsRUFHRUMsVUFBVSxDQUFDQyw2QkFIYixFQUlFTCxVQUFVLENBQUNNLFVBSmI7QUFNRDs7QUFFRCxTQUFPQSxVQUFQLENBQWtCQyxHQUFsQixFQUF1QjtBQUNyQixRQUFJQSxHQUFHLENBQUNDLElBQUosQ0FBU0MsVUFBYixFQUF5QjtBQUN2QixZQUFNLElBQUlDLFlBQU1DLEtBQVYsQ0FDSkQsWUFBTUMsS0FBTixDQUFZQyxtQkFEUixFQUVKLCtEQUZJLENBQU47QUFJRDs7QUFDRCxVQUFNQyxjQUFjLEdBQUdOLEdBQUcsQ0FBQ08sTUFBSixDQUFXRCxjQUFsQzs7QUFDQSxRQUFJLENBQUNBLGNBQUwsRUFBcUI7QUFDbkIsWUFBTSxJQUFJSCxZQUFNQyxLQUFWLENBQ0pELFlBQU1DLEtBQU4sQ0FBWUksa0JBRFIsRUFFSiw0QkFGSSxDQUFOO0FBSUQ7O0FBRUQsVUFBTUMsS0FBSyxHQUFHaEIsVUFBVSxDQUFDaUIsaUJBQVgsQ0FBNkJWLEdBQTdCLENBQWQ7QUFDQSxRQUFJVyxPQUFKO0FBQ0EsVUFBTUMsT0FBTyxHQUFHLElBQUlDLE9BQUosQ0FBWUMsUUFBUSxJQUFJO0FBQ3RDSCxNQUFBQSxPQUFPLEdBQUdHLFFBQVY7QUFDRCxLQUZlLENBQWhCO0FBR0EsUUFBSUMsWUFBSjtBQUNBVCxJQUFBQSxjQUFjLENBQ1hVLFFBREgsQ0FDWWhCLEdBQUcsQ0FBQ2lCLElBRGhCLEVBQ3NCUixLQUR0QixFQUM2QlQsR0FBRyxDQUFDTyxNQURqQyxFQUN5Q1AsR0FBRyxDQUFDQyxJQUQ3QyxFQUNtRGlCLFFBQVEsSUFBSTtBQUMzREgsTUFBQUEsWUFBWSxHQUFHRyxRQUFmO0FBQ0FQLE1BQUFBLE9BQU8sQ0FBQztBQUNOUSxRQUFBQSxPQUFPLEVBQUU7QUFDUCxvQ0FBMEJKO0FBRG5CLFNBREg7QUFJTkssUUFBQUEsUUFBUSxFQUFFO0FBQ1JDLFVBQUFBLE1BQU0sRUFBRTtBQURBO0FBSkosT0FBRCxDQUFQO0FBUUQsS0FYSCxFQVlHQyxLQVpILENBWVNDLEdBQUcsSUFBSTtBQUNadkIsTUFBQUEsR0FBRyxDQUFDTyxNQUFKLENBQVdpQixnQkFBWCxDQUE0QkMsS0FBNUIsQ0FDRyxlQUFjVixZQUFhLDRCQUQ5QixFQUVFUSxHQUZGO0FBSUQsS0FqQkg7QUFrQkEsV0FBT1gsT0FBUDtBQUNEO0FBRUQ7Ozs7Ozs7QUFLQSxTQUFPRixpQkFBUCxDQUF5QlYsR0FBekIsRUFBOEI7QUFDNUIsVUFBTWlCLElBQUksR0FBR2pCLEdBQUcsQ0FBQ2lCLElBQUosSUFBWSxFQUF6QjtBQUNBLFVBQU1TLFFBQVEsR0FBRyxPQUFPVCxJQUFJLENBQUNSLEtBQVosS0FBc0IsV0FBdkM7QUFDQSxVQUFNa0IsV0FBVyxHQUFHLE9BQU9WLElBQUksQ0FBQ1csUUFBWixLQUF5QixXQUE3QztBQUVBLFFBQUluQixLQUFKOztBQUNBLFFBQUlpQixRQUFRLElBQUlDLFdBQWhCLEVBQTZCO0FBQzNCLFlBQU0sSUFBSXhCLFlBQU1DLEtBQVYsQ0FDSkQsWUFBTUMsS0FBTixDQUFZSSxrQkFEUixFQUVKLHFEQUZJLENBQU47QUFJRCxLQUxELE1BS08sSUFBSWtCLFFBQUosRUFBYztBQUNuQmpCLE1BQUFBLEtBQUssR0FBR1EsSUFBSSxDQUFDUixLQUFiO0FBQ0QsS0FGTSxNQUVBLElBQUlrQixXQUFKLEVBQWlCO0FBQ3RCbEIsTUFBQUEsS0FBSyxHQUFHO0FBQ05tQixRQUFBQSxRQUFRLEVBQUU7QUFDUkMsVUFBQUEsR0FBRyxFQUFFWixJQUFJLENBQUNXO0FBREY7QUFESixPQUFSO0FBS0QsS0FOTSxNQU1BO0FBQ0wsWUFBTSxJQUFJekIsWUFBTUMsS0FBVixDQUNKRCxZQUFNQyxLQUFOLENBQVlJLGtCQURSLEVBRUosK0RBRkksQ0FBTjtBQUlEOztBQUNELFdBQU9DLEtBQVA7QUFDRDs7QUFuRjJDOzs7ZUFzRi9CaEIsVSIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBQcm9taXNlUm91dGVyIGZyb20gJy4uL1Byb21pc2VSb3V0ZXInO1xuaW1wb3J0ICogYXMgbWlkZGxld2FyZSBmcm9tICcuLi9taWRkbGV3YXJlcyc7XG5pbXBvcnQgeyBQYXJzZSB9IGZyb20gJ3BhcnNlL25vZGUnO1xuXG5leHBvcnQgY2xhc3MgUHVzaFJvdXRlciBleHRlbmRzIFByb21pc2VSb3V0ZXIge1xuICBtb3VudFJvdXRlcygpIHtcbiAgICB0aGlzLnJvdXRlKFxuICAgICAgJ1BPU1QnLFxuICAgICAgJy9wdXNoJyxcbiAgICAgIG1pZGRsZXdhcmUucHJvbWlzZUVuZm9yY2VNYXN0ZXJLZXlBY2Nlc3MsXG4gICAgICBQdXNoUm91dGVyLmhhbmRsZVBPU1RcbiAgICApO1xuICB9XG5cbiAgc3RhdGljIGhhbmRsZVBPU1QocmVxKSB7XG4gICAgaWYgKHJlcS5hdXRoLmlzUmVhZE9ubHkpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgICAgXCJyZWFkLW9ubHkgbWFzdGVyS2V5IGlzbid0IGFsbG93ZWQgdG8gc2VuZCBwdXNoIG5vdGlmaWNhdGlvbnMuXCJcbiAgICAgICk7XG4gICAgfVxuICAgIGNvbnN0IHB1c2hDb250cm9sbGVyID0gcmVxLmNvbmZpZy5wdXNoQ29udHJvbGxlcjtcbiAgICBpZiAoIXB1c2hDb250cm9sbGVyKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLlBVU0hfTUlTQ09ORklHVVJFRCxcbiAgICAgICAgJ1B1c2ggY29udHJvbGxlciBpcyBub3Qgc2V0J1xuICAgICAgKTtcbiAgICB9XG5cbiAgICBjb25zdCB3aGVyZSA9IFB1c2hSb3V0ZXIuZ2V0UXVlcnlDb25kaXRpb24ocmVxKTtcbiAgICBsZXQgcmVzb2x2ZTtcbiAgICBjb25zdCBwcm9taXNlID0gbmV3IFByb21pc2UoX3Jlc29sdmUgPT4ge1xuICAgICAgcmVzb2x2ZSA9IF9yZXNvbHZlO1xuICAgIH0pO1xuICAgIGxldCBwdXNoU3RhdHVzSWQ7XG4gICAgcHVzaENvbnRyb2xsZXJcbiAgICAgIC5zZW5kUHVzaChyZXEuYm9keSwgd2hlcmUsIHJlcS5jb25maWcsIHJlcS5hdXRoLCBvYmplY3RJZCA9PiB7XG4gICAgICAgIHB1c2hTdGF0dXNJZCA9IG9iamVjdElkO1xuICAgICAgICByZXNvbHZlKHtcbiAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAnWC1QYXJzZS1QdXNoLVN0YXR1cy1JZCc6IHB1c2hTdGF0dXNJZCxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHJlc3BvbnNlOiB7XG4gICAgICAgICAgICByZXN1bHQ6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVyciA9PiB7XG4gICAgICAgIHJlcS5jb25maWcubG9nZ2VyQ29udHJvbGxlci5lcnJvcihcbiAgICAgICAgICBgX1B1c2hTdGF0dXMgJHtwdXNoU3RhdHVzSWR9OiBlcnJvciB3aGlsZSBzZW5kaW5nIHB1c2hgLFxuICAgICAgICAgIGVyclxuICAgICAgICApO1xuICAgICAgfSk7XG4gICAgcmV0dXJuIHByb21pc2U7XG4gIH1cblxuICAvKipcbiAgICogR2V0IHF1ZXJ5IGNvbmRpdGlvbiBmcm9tIHRoZSByZXF1ZXN0IGJvZHkuXG4gICAqIEBwYXJhbSB7T2JqZWN0fSByZXEgQSByZXF1ZXN0IG9iamVjdFxuICAgKiBAcmV0dXJucyB7T2JqZWN0fSBUaGUgcXVlcnkgY29uZGl0aW9uLCB0aGUgd2hlcmUgZmllbGQgaW4gYSBxdWVyeSBhcGkgY2FsbFxuICAgKi9cbiAgc3RhdGljIGdldFF1ZXJ5Q29uZGl0aW9uKHJlcSkge1xuICAgIGNvbnN0IGJvZHkgPSByZXEuYm9keSB8fCB7fTtcbiAgICBjb25zdCBoYXNXaGVyZSA9IHR5cGVvZiBib2R5LndoZXJlICE9PSAndW5kZWZpbmVkJztcbiAgICBjb25zdCBoYXNDaGFubmVscyA9IHR5cGVvZiBib2R5LmNoYW5uZWxzICE9PSAndW5kZWZpbmVkJztcblxuICAgIGxldCB3aGVyZTtcbiAgICBpZiAoaGFzV2hlcmUgJiYgaGFzQ2hhbm5lbHMpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuUFVTSF9NSVNDT05GSUdVUkVELFxuICAgICAgICAnQ2hhbm5lbHMgYW5kIHF1ZXJ5IGNhbiBub3QgYmUgc2V0IGF0IHRoZSBzYW1lIHRpbWUuJ1xuICAgICAgKTtcbiAgICB9IGVsc2UgaWYgKGhhc1doZXJlKSB7XG4gICAgICB3aGVyZSA9IGJvZHkud2hlcmU7XG4gICAgfSBlbHNlIGlmIChoYXNDaGFubmVscykge1xuICAgICAgd2hlcmUgPSB7XG4gICAgICAgIGNoYW5uZWxzOiB7XG4gICAgICAgICAgJGluOiBib2R5LmNoYW5uZWxzLFxuICAgICAgICB9LFxuICAgICAgfTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgICdTZW5kaW5nIGEgcHVzaCByZXF1aXJlcyBlaXRoZXIgXCJjaGFubmVsc1wiIG9yIGEgXCJ3aGVyZVwiIHF1ZXJ5LidcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiB3aGVyZTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBQdXNoUm91dGVyO1xuIl19