"use strict";

var _node = require("parse/node");

var triggers = _interopRequireWildcard(require("../triggers"));

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = Object.defineProperty && Object.getOwnPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : {}; if (desc.get || desc.set) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } } newObj.default = obj; return newObj; } }

function getClassName(parseClass) {
  if (parseClass && parseClass.className) {
    return parseClass.className;
  }

  return parseClass;
}
/** @namespace
 * @name Parse
 * @description The Parse SDK.
 *  see [api docs](https://docs.parseplatform.org/js/api) and [guide](https://docs.parseplatform.org/js/guide)
 */

/** @namespace
 * @name Parse.Cloud
 * @memberof Parse
 * @description The Parse Cloud Code SDK.
 */


var ParseCloud = {};
/**
 * Defines a Cloud Function.
 *
 * **Available in Cloud Code only.**

 * @static
 * @memberof Parse.Cloud
 * @param {String} name The name of the Cloud Function
 * @param {Function} data The Cloud Function to register. This function can be an async function and should take one parameter a {@link Parse.Cloud.FunctionRequest}.
 */

ParseCloud.define = function (functionName, handler, validationHandler) {
  triggers.addFunction(functionName, handler, validationHandler, _node.Parse.applicationId);
};
/**
 * Defines a Background Job.
 *
 * **Available in Cloud Code only.**
 *
 * @method job
 * @name Parse.Cloud.job
 * @param {String} name The name of the Background Job
 * @param {Function} func The Background Job to register. This function can be async should take a single parameters a {@link Parse.Cloud.JobRequest}
 *
 */


ParseCloud.job = function (functionName, handler) {
  triggers.addJob(functionName, handler, _node.Parse.applicationId);
};
/**
 *
 * Registers a before save function.
 *
 * **Available in Cloud Code only.**
 *
 * If you want to use beforeSave for a predefined class in the Parse JavaScript SDK (e.g. {@link Parse.User}), you should pass the class itself and not the String for arg1.
 *
 * ```
 * Parse.Cloud.beforeSave('MyCustomClass', (request) => {
 *   // code here
 * })
 *
 * Parse.Cloud.beforeSave(Parse.User, (request) => {
 *   // code here
 * })
 * ```
 *
 * @method beforeSave
 * @name Parse.Cloud.beforeSave
 * @param {(String|Parse.Object)} arg1 The Parse.Object subclass to register the after save function for. This can instead be a String that is the className of the subclass.
 * @param {Function} func The function to run before a save. This function can be async and should take one parameter a {@link Parse.Cloud.TriggerRequest};
 */


ParseCloud.beforeSave = function (parseClass, handler) {
  var className = getClassName(parseClass);
  triggers.addTrigger(triggers.Types.beforeSave, className, handler, _node.Parse.applicationId);
};
/**
 * Registers a before delete function.
 *
 * **Available in Cloud Code only.**
 *
 * If you want to use beforeDelete for a predefined class in the Parse JavaScript SDK (e.g. {@link Parse.User}), you should pass the class itself and not the String for arg1.
 * ```
 * Parse.Cloud.beforeDelete('MyCustomClass', (request) => {
 *   // code here
 * })
 *
 * Parse.Cloud.beforeDelete(Parse.User, (request) => {
 *   // code here
 * })
 *```
 *
 * @method beforeDelete
 * @name Parse.Cloud.beforeDelete
 * @param {(String|Parse.Object)} arg1 The Parse.Object subclass to register the before delete function for. This can instead be a String that is the className of the subclass.
 * @param {Function} func The function to run before a delete. This function can be async and should take one parameter, a {@link Parse.Cloud.TriggerRequest}.
 */


ParseCloud.beforeDelete = function (parseClass, handler) {
  var className = getClassName(parseClass);
  triggers.addTrigger(triggers.Types.beforeDelete, className, handler, _node.Parse.applicationId);
};
/**
 * Registers an after save function.
 *
 * **Available in Cloud Code only.**
 *
 * If you want to use afterSave for a predefined class in the Parse JavaScript SDK (e.g. {@link Parse.User}), you should pass the class itself and not the String for arg1.
 *
 * ```
 * Parse.Cloud.afterSave('MyCustomClass', async function(request) {
 *   // code here
 * })
 *
 * Parse.Cloud.afterSave(Parse.User, async function(request) {
 *   // code here
 * })
 * ```
 *
 * @method afterSave
 * @name Parse.Cloud.afterSave
 * @param {(String|Parse.Object)} arg1 The Parse.Object subclass to register the after save function for. This can instead be a String that is the className of the subclass.
 * @param {Function} func The function to run after a save. This function can be an async function and should take just one parameter, {@link Parse.Cloud.TriggerRequest}.
 */


ParseCloud.afterSave = function (parseClass, handler) {
  var className = getClassName(parseClass);
  triggers.addTrigger(triggers.Types.afterSave, className, handler, _node.Parse.applicationId);
};
/**
 * Registers an after delete function.
 *
 * **Available in Cloud Code only.**
 *
 * If you want to use afterDelete for a predefined class in the Parse JavaScript SDK (e.g. {@link Parse.User}), you should pass the class itself and not the String for arg1.
 * ```
 * Parse.Cloud.afterDelete('MyCustomClass', async (request) => {
 *   // code here
 * })
 *
 * Parse.Cloud.afterDelete(Parse.User, async (request) => {
 *   // code here
 * })
 *```
 *
 * @method afterDelete
 * @name Parse.Cloud.afterDelete
 * @param {(String|Parse.Object)} arg1 The Parse.Object subclass to register the after delete function for. This can instead be a String that is the className of the subclass.
 * @param {Function} func The function to run after a delete. This function can be async and should take just one parameter, {@link Parse.Cloud.TriggerRequest}.
 */


ParseCloud.afterDelete = function (parseClass, handler) {
  var className = getClassName(parseClass);
  triggers.addTrigger(triggers.Types.afterDelete, className, handler, _node.Parse.applicationId);
};
/**
 * Registers a before find function.
 *
 * **Available in Cloud Code only.**
 *
 * If you want to use beforeFind for a predefined class in the Parse JavaScript SDK (e.g. {@link Parse.User}), you should pass the class itself and not the String for arg1.
 * ```
 * Parse.Cloud.beforeFind('MyCustomClass', async (request) => {
 *   // code here
 * })
 *
 * Parse.Cloud.beforeFind(Parse.User, async (request) => {
 *   // code here
 * })
 *```
 *
 * @method beforeFind
 * @name Parse.Cloud.beforeFind
 * @param {(String|Parse.Object)} arg1 The Parse.Object subclass to register the before find function for. This can instead be a String that is the className of the subclass.
 * @param {Function} func The function to run before a find. This function can be async and should take just one parameter, {@link Parse.Cloud.BeforeFindRequest}.
 */


ParseCloud.beforeFind = function (parseClass, handler) {
  var className = getClassName(parseClass);
  triggers.addTrigger(triggers.Types.beforeFind, className, handler, _node.Parse.applicationId);
};
/**
 * Registers an after find function.
 *
 * **Available in Cloud Code only.**
 *
 * If you want to use afterFind for a predefined class in the Parse JavaScript SDK (e.g. {@link Parse.User}), you should pass the class itself and not the String for arg1.
 * ```
 * Parse.Cloud.afterFind('MyCustomClass', async (request) => {
 *   // code here
 * })
 *
 * Parse.Cloud.afterFind(Parse.User, async (request) => {
 *   // code here
 * })
 *```
 *
 * @method afterFind
 * @name Parse.Cloud.afterFind
 * @param {(String|Parse.Object)} arg1 The Parse.Object subclass to register the after find function for. This can instead be a String that is the className of the subclass.
 * @param {Function} func The function to run before a find. This function can be async and should take just one parameter, {@link Parse.Cloud.AfterFindRequest}.
 */


ParseCloud.afterFind = function (parseClass, handler) {
  const className = getClassName(parseClass);
  triggers.addTrigger(triggers.Types.afterFind, className, handler, _node.Parse.applicationId);
};

ParseCloud.onLiveQueryEvent = function (handler) {
  triggers.addLiveQueryEventHandler(handler, _node.Parse.applicationId);
};

ParseCloud._removeAllHooks = () => {
  triggers._unregisterAll();
};

ParseCloud.useMasterKey = () => {
  // eslint-disable-next-line
  console.warn('Parse.Cloud.useMasterKey is deprecated (and has no effect anymore) on parse-server, please refer to the cloud code migration notes: http://docs.parseplatform.org/parse-server/guide/#master-key-must-be-passed-explicitly');
};

ParseCloud.httpRequest = require('./httpRequest');
module.exports = ParseCloud;
/**
 * @interface Parse.Cloud.TriggerRequest
 * @property {String} installationId If set, the installationId triggering the request.
 * @property {Boolean} master If true, means the master key was used.
 * @property {Parse.User} user If set, the user that made the request.
 * @property {Parse.Object} object The object triggering the hook.
 * @property {String} ip The IP address of the client making the request.
 * @property {Object} headers The original HTTP headers for the request.
 * @property {String} triggerName The name of the trigger (`beforeSave`, `afterSave`, ...)
 * @property {Object} log The current logger inside Parse Server.
 * @property {Parse.Object} original If set, the object, as currently stored.
 */

/**
 * @interface Parse.Cloud.BeforeFindRequest
 * @property {String} installationId If set, the installationId triggering the request.
 * @property {Boolean} master If true, means the master key was used.
 * @property {Parse.User} user If set, the user that made the request.
 * @property {Parse.Query} query The query triggering the hook.
 * @property {String} ip The IP address of the client making the request.
 * @property {Object} headers The original HTTP headers for the request.
 * @property {String} triggerName The name of the trigger (`beforeSave`, `afterSave`, ...)
 * @property {Object} log The current logger inside Parse Server.
 * @property {Boolean} isGet wether the query a `get` or a `find`
 */

/**
 * @interface Parse.Cloud.AfterFindRequest
 * @property {String} installationId If set, the installationId triggering the request.
 * @property {Boolean} master If true, means the master key was used.
 * @property {Parse.User} user If set, the user that made the request.
 * @property {Parse.Query} query The query triggering the hook.
 * @property {Array<Parse.Object>} results The results the query yielded.
 * @property {String} ip The IP address of the client making the request.
 * @property {Object} headers The original HTTP headers for the request.
 * @property {String} triggerName The name of the trigger (`beforeSave`, `afterSave`, ...)
 * @property {Object} log The current logger inside Parse Server.
 */

/**
 * @interface Parse.Cloud.FunctionRequest
 * @property {String} installationId If set, the installationId triggering the request.
 * @property {Boolean} master If true, means the master key was used.
 * @property {Parse.User} user If set, the user that made the request.
 * @property {Object} params The params passed to the cloud function.
 */

/**
 * @interface Parse.Cloud.JobRequest
 * @property {Object} params The params passed to the background job.
 * @property {function} message If message is called with a string argument, will update the current message to be stored in the job status.
 */
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9jbG91ZC1jb2RlL1BhcnNlLkNsb3VkLmpzIl0sIm5hbWVzIjpbImdldENsYXNzTmFtZSIsInBhcnNlQ2xhc3MiLCJjbGFzc05hbWUiLCJQYXJzZUNsb3VkIiwiZGVmaW5lIiwiZnVuY3Rpb25OYW1lIiwiaGFuZGxlciIsInZhbGlkYXRpb25IYW5kbGVyIiwidHJpZ2dlcnMiLCJhZGRGdW5jdGlvbiIsIlBhcnNlIiwiYXBwbGljYXRpb25JZCIsImpvYiIsImFkZEpvYiIsImJlZm9yZVNhdmUiLCJhZGRUcmlnZ2VyIiwiVHlwZXMiLCJiZWZvcmVEZWxldGUiLCJhZnRlclNhdmUiLCJhZnRlckRlbGV0ZSIsImJlZm9yZUZpbmQiLCJhZnRlckZpbmQiLCJvbkxpdmVRdWVyeUV2ZW50IiwiYWRkTGl2ZVF1ZXJ5RXZlbnRIYW5kbGVyIiwiX3JlbW92ZUFsbEhvb2tzIiwiX3VucmVnaXN0ZXJBbGwiLCJ1c2VNYXN0ZXJLZXkiLCJjb25zb2xlIiwid2FybiIsImh0dHBSZXF1ZXN0IiwicmVxdWlyZSIsIm1vZHVsZSIsImV4cG9ydHMiXSwibWFwcGluZ3MiOiI7O0FBQUE7O0FBQ0E7Ozs7QUFFQSxTQUFTQSxZQUFULENBQXNCQyxVQUF0QixFQUFrQztBQUNoQyxNQUFJQSxVQUFVLElBQUlBLFVBQVUsQ0FBQ0MsU0FBN0IsRUFBd0M7QUFDdEMsV0FBT0QsVUFBVSxDQUFDQyxTQUFsQjtBQUNEOztBQUNELFNBQU9ELFVBQVA7QUFDRDtBQUVEOzs7Ozs7QUFNQTs7Ozs7OztBQU1BLElBQUlFLFVBQVUsR0FBRyxFQUFqQjtBQUNBOzs7Ozs7Ozs7OztBQVVBQSxVQUFVLENBQUNDLE1BQVgsR0FBb0IsVUFBU0MsWUFBVCxFQUF1QkMsT0FBdkIsRUFBZ0NDLGlCQUFoQyxFQUFtRDtBQUNyRUMsRUFBQUEsUUFBUSxDQUFDQyxXQUFULENBQ0VKLFlBREYsRUFFRUMsT0FGRixFQUdFQyxpQkFIRixFQUlFRyxZQUFNQyxhQUpSO0FBTUQsQ0FQRDtBQVNBOzs7Ozs7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QUFUO0FBQ0QsQ0FGRDs7QUFJQXRCLFVBQVUsQ0FBQ3VCLFlBQVgsR0FBMEIsTUFBTTtBQUM5QjtBQUNBQyxFQUFBQSxPQUFPLENBQUNDLElBQVIsQ0FDRSw0TkFERjtBQUdELENBTEQ7O0FBT0F6QixVQUFVLENBQUMwQixXQUFYLEdBQXlCQyxPQUFPLENBQUMsZUFBRCxDQUFoQztBQUVBQyxNQUFNLENBQUNDLE9BQVAsR0FBaUI3QixVQUFqQjtBQUVBOzs7Ozs7Ozs7Ozs7O0FBYUE7Ozs7Ozs7Ozs7Ozs7QUFhQTs7Ozs7Ozs7Ozs7OztBQWFBOzs7Ozs7OztBQVFBIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgUGFyc2UgfSBmcm9tICdwYXJzZS9ub2RlJztcbmltcG9ydCAqIGFzIHRyaWdnZXJzIGZyb20gJy4uL3RyaWdnZXJzJztcblxuZnVuY3Rpb24gZ2V0Q2xhc3NOYW1lKHBhcnNlQ2xhc3MpIHtcbiAgaWYgKHBhcnNlQ2xhc3MgJiYgcGFyc2VDbGFzcy5jbGFzc05hbWUpIHtcbiAgICByZXR1cm4gcGFyc2VDbGFzcy5jbGFzc05hbWU7XG4gIH1cbiAgcmV0dXJuIHBhcnNlQ2xhc3M7XG59XG5cbi8qKiBAbmFtZXNwYWNlXG4gKiBAbmFtZSBQYXJzZVxuICogQGRlc2NyaXB0aW9uIFRoZSBQYXJzZSBTREsuXG4gKiAgc2VlIFthcGkgZG9jc10oaHR0cHM6Ly9kb2NzLnBhcnNlcGxhdGZvcm0ub3JnL2pzL2FwaSkgYW5kIFtndWlkZV0oaHR0cHM6Ly9kb2NzLnBhcnNlcGxhdGZvcm0ub3JnL2pzL2d1aWRlKVxuICovXG5cbi8qKiBAbmFtZXNwYWNlXG4gKiBAbmFtZSBQYXJzZS5DbG91ZFxuICogQG1lbWJlcm9mIFBhcnNlXG4gKiBAZGVzY3JpcHRpb24gVGhlIFBhcnNlIENsb3VkIENvZGUgU0RLLlxuICovXG5cbnZhciBQYXJzZUNsb3VkID0ge307XG4vKipcbiAqIERlZmluZXMgYSBDbG91ZCBGdW5jdGlvbi5cbiAqXG4gKiAqKkF2YWlsYWJsZSBpbiBDbG91ZCBDb2RlIG9ubHkuKipcblxuICogQHN0YXRpY1xuICogQG1lbWJlcm9mIFBhcnNlLkNsb3VkXG4gKiBAcGFyYW0ge1N0cmluZ30gbmFtZSBUaGUgbmFtZSBvZiB0aGUgQ2xvdWQgRnVuY3Rpb25cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGRhdGEgVGhlIENsb3VkIEZ1bmN0aW9uIHRvIHJlZ2lzdGVyLiBUaGlzIGZ1bmN0aW9uIGNhbiBiZSBhbiBhc3luYyBmdW5jdGlvbiBhbmQgc2hvdWxkIHRha2Ugb25lIHBhcmFtZXRlciBhIHtAbGluayBQYXJzZS5DbG91ZC5GdW5jdGlvblJlcXVlc3R9LlxuICovXG5QYXJzZUNsb3VkLmRlZmluZSA9IGZ1bmN0aW9uKGZ1bmN0aW9uTmFtZSwgaGFuZGxlciwgdmFsaWRhdGlvbkhhbmRsZXIpIHtcbiAgdHJpZ2dlcnMuYWRkRnVuY3Rpb24oXG4gICAgZnVuY3Rpb25OYW1lLFxuICAgIGhhbmRsZXIsXG4gICAgdmFsaWRhdGlvbkhhbmRsZXIsXG4gICAgUGFyc2UuYXBwbGljYXRpb25JZFxuICApO1xufTtcblxuLyoqXG4gKiBEZWZpbmVzIGEgQmFja2dyb3VuZCBKb2IuXG4gKlxuICogKipBdmFpbGFibGUgaW4gQ2xvdWQgQ29kZSBvbmx5LioqXG4gKlxuICogQG1ldGhvZCBqb2JcbiAqIEBuYW1lIFBhcnNlLkNsb3VkLmpvYlxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWUgVGhlIG5hbWUgb2YgdGhlIEJhY2tncm91bmQgSm9iXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmdW5jIFRoZSBCYWNrZ3JvdW5kIEpvYiB0byByZWdpc3Rlci4gVGhpcyBmdW5jdGlvbiBjYW4gYmUgYXN5bmMgc2hvdWxkIHRha2UgYSBzaW5nbGUgcGFyYW1ldGVycyBhIHtAbGluayBQYXJzZS5DbG91ZC5Kb2JSZXF1ZXN0fVxuICpcbiAqL1xuUGFyc2VDbG91ZC5qb2IgPSBmdW5jdGlvbihmdW5jdGlvbk5hbWUsIGhhbmRsZXIpIHtcbiAgdHJpZ2dlcnMuYWRkSm9iKGZ1bmN0aW9uTmFtZSwgaGFuZGxlciwgUGFyc2UuYXBwbGljYXRpb25JZCk7XG59O1xuXG4vKipcbiAqXG4gKiBSZWdpc3RlcnMgYSBiZWZvcmUgc2F2ZSBmdW5jdGlvbi5cbiAqXG4gKiAqKkF2YWlsYWJsZSBpbiBDbG91ZCBDb2RlIG9ubHkuKipcbiAqXG4gKiBJZiB5b3Ugd2FudCB0byB1c2UgYmVmb3JlU2F2ZSBmb3IgYSBwcmVkZWZpbmVkIGNsYXNzIGluIHRoZSBQYXJzZSBKYXZhU2NyaXB0IFNESyAoZS5nLiB7QGxpbmsgUGFyc2UuVXNlcn0pLCB5b3Ugc2hvdWxkIHBhc3MgdGhlIGNsYXNzIGl0c2VsZiBhbmQgbm90IHRoZSBTdHJpbmcgZm9yIGFyZzEuXG4gKlxuICogYGBgXG4gKiBQYXJzZS5DbG91ZC5iZWZvcmVTYXZlKCdNeUN1c3RvbUNsYXNzJywgKHJlcXVlc3QpID0+IHtcbiAqICAgLy8gY29kZSBoZXJlXG4gKiB9KVxuICpcbiAqIFBhcnNlLkNsb3VkLmJlZm9yZVNhdmUoUGFyc2UuVXNlciwgKHJlcXVlc3QpID0+IHtcbiAqICAgLy8gY29kZSBoZXJlXG4gKiB9KVxuICogYGBgXG4gKlxuICogQG1ldGhvZCBiZWZvcmVTYXZlXG4gKiBAbmFtZSBQYXJzZS5DbG91ZC5iZWZvcmVTYXZlXG4gKiBAcGFyYW0geyhTdHJpbmd8UGFyc2UuT2JqZWN0KX0gYXJnMSBUaGUgUGFyc2UuT2JqZWN0IHN1YmNsYXNzIHRvIHJlZ2lzdGVyIHRoZSBhZnRlciBzYXZlIGZ1bmN0aW9uIGZvci4gVGhpcyBjYW4gaW5zdGVhZCBiZSBhIFN0cmluZyB0aGF0IGlzIHRoZSBjbGFzc05hbWUgb2YgdGhlIHN1YmNsYXNzLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZnVuYyBUaGUgZnVuY3Rpb24gdG8gcnVuIGJlZm9yZSBhIHNhdmUuIFRoaXMgZnVuY3Rpb24gY2FuIGJlIGFzeW5jIGFuZCBzaG91bGQgdGFrZSBvbmUgcGFyYW1ldGVyIGEge0BsaW5rIFBhcnNlLkNsb3VkLlRyaWdnZXJSZXF1ZXN0fTtcbiAqL1xuUGFyc2VDbG91ZC5iZWZvcmVTYXZlID0gZnVuY3Rpb24ocGFyc2VDbGFzcywgaGFuZGxlcikge1xuICB2YXIgY2xhc3NOYW1lID0gZ2V0Q2xhc3NOYW1lKHBhcnNlQ2xhc3MpO1xuICB0cmlnZ2Vycy5hZGRUcmlnZ2VyKFxuICAgIHRyaWdnZXJzLlR5cGVzLmJlZm9yZVNhdmUsXG4gICAgY2xhc3NOYW1lLFxuICAgIGhhbmRsZXIsXG4gICAgUGFyc2UuYXBwbGljYXRpb25JZFxuICApO1xufTtcblxuLyoqXG4gKiBSZWdpc3RlcnMgYSBiZWZvcmUgZGVsZXRlIGZ1bmN0aW9uLlxuICpcbiAqICoqQXZhaWxhYmxlIGluIENsb3VkIENvZGUgb25seS4qKlxuICpcbiAqIElmIHlvdSB3YW50IHRvIHVzZSBiZWZvcmVEZWxldGUgZm9yIGEgcHJlZGVmaW5lZCBjbGFzcyBpbiB0aGUgUGFyc2UgSmF2YVNjcmlwdCBTREsgKGUuZy4ge0BsaW5rIFBhcnNlLlVzZXJ9KSwgeW91IHNob3VsZCBwYXNzIHRoZSBjbGFzcyBpdHNlbGYgYW5kIG5vdCB0aGUgU3RyaW5nIGZvciBhcmcxLlxuICogYGBgXG4gKiBQYXJzZS5DbG91ZC5iZWZvcmVEZWxldGUoJ015Q3VzdG9tQ2xhc3MnLCAocmVxdWVzdCkgPT4ge1xuICogICAvLyBjb2RlIGhlcmVcbiAqIH0pXG4gKlxuICogUGFyc2UuQ2xvdWQuYmVmb3JlRGVsZXRlKFBhcnNlLlVzZXIsIChyZXF1ZXN0KSA9PiB7XG4gKiAgIC8vIGNvZGUgaGVyZVxuICogfSlcbiAqYGBgXG4gKlxuICogQG1ldGhvZCBiZWZvcmVEZWxldGVcbiAqIEBuYW1lIFBhcnNlLkNsb3VkLmJlZm9yZURlbGV0ZVxuICogQHBhcmFtIHsoU3RyaW5nfFBhcnNlLk9iamVjdCl9IGFyZzEgVGhlIFBhcnNlLk9iamVjdCBzdWJjbGFzcyB0byByZWdpc3RlciB0aGUgYmVmb3JlIGRlbGV0ZSBmdW5jdGlvbiBmb3IuIFRoaXMgY2FuIGluc3RlYWQgYmUgYSBTdHJpbmcgdGhhdCBpcyB0aGUgY2xhc3NOYW1lIG9mIHRoZSBzdWJjbGFzcy5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZ1bmMgVGhlIGZ1bmN0aW9uIHRvIHJ1biBiZWZvcmUgYSBkZWxldGUuIFRoaXMgZnVuY3Rpb24gY2FuIGJlIGFzeW5jIGFuZCBzaG91bGQgdGFrZSBvbmUgcGFyYW1ldGVyLCBhIHtAbGluayBQYXJzZS5DbG91ZC5UcmlnZ2VyUmVxdWVzdH0uXG4gKi9cblBhcnNlQ2xvdWQuYmVmb3JlRGVsZXRlID0gZnVuY3Rpb24ocGFyc2VDbGFzcywgaGFuZGxlcikge1xuICB2YXIgY2xhc3NOYW1lID0gZ2V0Q2xhc3NOYW1lKHBhcnNlQ2xhc3MpO1xuICB0cmlnZ2Vycy5hZGRUcmlnZ2VyKFxuICAgIHRyaWdnZXJzLlR5cGVzLmJlZm9yZURlbGV0ZSxcbiAgICBjbGFzc05hbWUsXG4gICAgaGFuZGxlcixcbiAgICBQYXJzZS5hcHBsaWNhdGlvbklkXG4gICk7XG59O1xuXG4vKipcbiAqIFJlZ2lzdGVycyBhbiBhZnRlciBzYXZlIGZ1bmN0aW9uLlxuICpcbiAqICoqQXZhaWxhYmxlIGluIENsb3VkIENvZGUgb25seS4qKlxuICpcbiAqIElmIHlvdSB3YW50IHRvIHVzZSBhZnRlclNhdmUgZm9yIGEgcHJlZGVmaW5lZCBjbGFzcyBpbiB0aGUgUGFyc2UgSmF2YVNjcmlwdCBTREsgKGUuZy4ge0BsaW5rIFBhcnNlLlVzZXJ9KSwgeW91IHNob3VsZCBwYXNzIHRoZSBjbGFzcyBpdHNlbGYgYW5kIG5vdCB0aGUgU3RyaW5nIGZvciBhcmcxLlxuICpcbiAqIGBgYFxuICogUGFyc2UuQ2xvdWQuYWZ0ZXJTYXZlKCdNeUN1c3RvbUNsYXNzJywgYXN5bmMgZnVuY3Rpb24ocmVxdWVzdCkge1xuICogICAvLyBjb2RlIGhlcmVcbiAqIH0pXG4gKlxuICogUGFyc2UuQ2xvdWQuYWZ0ZXJTYXZlKFBhcnNlLlVzZXIsIGFzeW5jIGZ1bmN0aW9uKHJlcXVlc3QpIHtcbiAqICAgLy8gY29kZSBoZXJlXG4gKiB9KVxuICogYGBgXG4gKlxuICogQG1ldGhvZCBhZnRlclNhdmVcbiAqIEBuYW1lIFBhcnNlLkNsb3VkLmFmdGVyU2F2ZVxuICogQHBhcmFtIHsoU3RyaW5nfFBhcnNlLk9iamVjdCl9IGFyZzEgVGhlIFBhcnNlLk9iamVjdCBzdWJjbGFzcyB0byByZWdpc3RlciB0aGUgYWZ0ZXIgc2F2ZSBmdW5jdGlvbiBmb3IuIFRoaXMgY2FuIGluc3RlYWQgYmUgYSBTdHJpbmcgdGhhdCBpcyB0aGUgY2xhc3NOYW1lIG9mIHRoZSBzdWJjbGFzcy5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZ1bmMgVGhlIGZ1bmN0aW9uIHRvIHJ1biBhZnRlciBhIHNhdmUuIFRoaXMgZnVuY3Rpb24gY2FuIGJlIGFuIGFzeW5jIGZ1bmN0aW9uIGFuZCBzaG91bGQgdGFrZSBqdXN0IG9uZSBwYXJhbWV0ZXIsIHtAbGluayBQYXJzZS5DbG91ZC5UcmlnZ2VyUmVxdWVzdH0uXG4gKi9cblBhcnNlQ2xvdWQuYWZ0ZXJTYXZlID0gZnVuY3Rpb24ocGFyc2VDbGFzcywgaGFuZGxlcikge1xuICB2YXIgY2xhc3NOYW1lID0gZ2V0Q2xhc3NOYW1lKHBhcnNlQ2xhc3MpO1xuICB0cmlnZ2Vycy5hZGRUcmlnZ2VyKFxuICAgIHRyaWdnZXJzLlR5cGVzLmFmdGVyU2F2ZSxcbiAgICBjbGFzc05hbWUsXG4gICAgaGFuZGxlcixcbiAgICBQYXJzZS5hcHBsaWNhdGlvbklkXG4gICk7XG59O1xuXG4vKipcbiAqIFJlZ2lzdGVycyBhbiBhZnRlciBkZWxldGUgZnVuY3Rpb24uXG4gKlxuICogKipBdmFpbGFibGUgaW4gQ2xvdWQgQ29kZSBvbmx5LioqXG4gKlxuICogSWYgeW91IHdhbnQgdG8gdXNlIGFmdGVyRGVsZXRlIGZvciBhIHByZWRlZmluZWQgY2xhc3MgaW4gdGhlIFBhcnNlIEphdmFTY3JpcHQgU0RLIChlLmcuIHtAbGluayBQYXJzZS5Vc2VyfSksIHlvdSBzaG91bGQgcGFzcyB0aGUgY2xhc3MgaXRzZWxmIGFuZCBub3QgdGhlIFN0cmluZyBmb3IgYXJnMS5cbiAqIGBgYFxuICogUGFyc2UuQ2xvdWQuYWZ0ZXJEZWxldGUoJ015Q3VzdG9tQ2xhc3MnLCBhc3luYyAocmVxdWVzdCkgPT4ge1xuICogICAvLyBjb2RlIGhlcmVcbiAqIH0pXG4gKlxuICogUGFyc2UuQ2xvdWQuYWZ0ZXJEZWxldGUoUGFyc2UuVXNlciwgYXN5bmMgKHJlcXVlc3QpID0+IHtcbiAqICAgLy8gY29kZSBoZXJlXG4gKiB9KVxuICpgYGBcbiAqXG4gKiBAbWV0aG9kIGFmdGVyRGVsZXRlXG4gKiBAbmFtZSBQYXJzZS5DbG91ZC5hZnRlckRlbGV0ZVxuICogQHBhcmFtIHsoU3RyaW5nfFBhcnNlLk9iamVjdCl9IGFyZzEgVGhlIFBhcnNlLk9iamVjdCBzdWJjbGFzcyB0byByZWdpc3RlciB0aGUgYWZ0ZXIgZGVsZXRlIGZ1bmN0aW9uIGZvci4gVGhpcyBjYW4gaW5zdGVhZCBiZSBhIFN0cmluZyB0aGF0IGlzIHRoZSBjbGFzc05hbWUgb2YgdGhlIHN1YmNsYXNzLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZnVuYyBUaGUgZnVuY3Rpb24gdG8gcnVuIGFmdGVyIGEgZGVsZXRlLiBUaGlzIGZ1bmN0aW9uIGNhbiBiZSBhc3luYyBhbmQgc2hvdWxkIHRha2UganVzdCBvbmUgcGFyYW1ldGVyLCB7QGxpbmsgUGFyc2UuQ2xvdWQuVHJpZ2dlclJlcXVlc3R9LlxuICovXG5QYXJzZUNsb3VkLmFmdGVyRGVsZXRlID0gZnVuY3Rpb24ocGFyc2VDbGFzcywgaGFuZGxlcikge1xuICB2YXIgY2xhc3NOYW1lID0gZ2V0Q2xhc3NOYW1lKHBhcnNlQ2xhc3MpO1xuICB0cmlnZ2Vycy5hZGRUcmlnZ2VyKFxuICAgIHRyaWdnZXJzLlR5cGVzLmFmdGVyRGVsZXRlLFxuICAgIGNsYXNzTmFtZSxcbiAgICBoYW5kbGVyLFxuICAgIFBhcnNlLmFwcGxpY2F0aW9uSWRcbiAgKTtcbn07XG5cbi8qKlxuICogUmVnaXN0ZXJzIGEgYmVmb3JlIGZpbmQgZnVuY3Rpb24uXG4gKlxuICogKipBdmFpbGFibGUgaW4gQ2xvdWQgQ29kZSBvbmx5LioqXG4gKlxuICogSWYgeW91IHdhbnQgdG8gdXNlIGJlZm9yZUZpbmQgZm9yIGEgcHJlZGVmaW5lZCBjbGFzcyBpbiB0aGUgUGFyc2UgSmF2YVNjcmlwdCBTREsgKGUuZy4ge0BsaW5rIFBhcnNlLlVzZXJ9KSwgeW91IHNob3VsZCBwYXNzIHRoZSBjbGFzcyBpdHNlbGYgYW5kIG5vdCB0aGUgU3RyaW5nIGZvciBhcmcxLlxuICogYGBgXG4gKiBQYXJzZS5DbG91ZC5iZWZvcmVGaW5kKCdNeUN1c3RvbUNsYXNzJywgYXN5bmMgKHJlcXVlc3QpID0+IHtcbiAqICAgLy8gY29kZSBoZXJlXG4gKiB9KVxuICpcbiAqIFBhcnNlLkNsb3VkLmJlZm9yZUZpbmQoUGFyc2UuVXNlciwgYXN5bmMgKHJlcXVlc3QpID0+IHtcbiAqICAgLy8gY29kZSBoZXJlXG4gKiB9KVxuICpgYGBcbiAqXG4gKiBAbWV0aG9kIGJlZm9yZUZpbmRcbiAqIEBuYW1lIFBhcnNlLkNsb3VkLmJlZm9yZUZpbmRcbiAqIEBwYXJhbSB7KFN0cmluZ3xQYXJzZS5PYmplY3QpfSBhcmcxIFRoZSBQYXJzZS5PYmplY3Qgc3ViY2xhc3MgdG8gcmVnaXN0ZXIgdGhlIGJlZm9yZSBmaW5kIGZ1bmN0aW9uIGZvci4gVGhpcyBjYW4gaW5zdGVhZCBiZSBhIFN0cmluZyB0aGF0IGlzIHRoZSBjbGFzc05hbWUgb2YgdGhlIHN1YmNsYXNzLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZnVuYyBUaGUgZnVuY3Rpb24gdG8gcnVuIGJlZm9yZSBhIGZpbmQuIFRoaXMgZnVuY3Rpb24gY2FuIGJlIGFzeW5jIGFuZCBzaG91bGQgdGFrZSBqdXN0IG9uZSBwYXJhbWV0ZXIsIHtAbGluayBQYXJzZS5DbG91ZC5CZWZvcmVGaW5kUmVxdWVzdH0uXG4gKi9cblBhcnNlQ2xvdWQuYmVmb3JlRmluZCA9IGZ1bmN0aW9uKHBhcnNlQ2xhc3MsIGhhbmRsZXIpIHtcbiAgdmFyIGNsYXNzTmFtZSA9IGdldENsYXNzTmFtZShwYXJzZUNsYXNzKTtcbiAgdHJpZ2dlcnMuYWRkVHJpZ2dlcihcbiAgICB0cmlnZ2Vycy5UeXBlcy5iZWZvcmVGaW5kLFxuICAgIGNsYXNzTmFtZSxcbiAgICBoYW5kbGVyLFxuICAgIFBhcnNlLmFwcGxpY2F0aW9uSWRcbiAgKTtcbn07XG5cbi8qKlxuICogUmVnaXN0ZXJzIGFuIGFmdGVyIGZpbmQgZnVuY3Rpb24uXG4gKlxuICogKipBdmFpbGFibGUgaW4gQ2xvdWQgQ29kZSBvbmx5LioqXG4gKlxuICogSWYgeW91IHdhbnQgdG8gdXNlIGFmdGVyRmluZCBmb3IgYSBwcmVkZWZpbmVkIGNsYXNzIGluIHRoZSBQYXJzZSBKYXZhU2NyaXB0IFNESyAoZS5nLiB7QGxpbmsgUGFyc2UuVXNlcn0pLCB5b3Ugc2hvdWxkIHBhc3MgdGhlIGNsYXNzIGl0c2VsZiBhbmQgbm90IHRoZSBTdHJpbmcgZm9yIGFyZzEuXG4gKiBgYGBcbiAqIFBhcnNlLkNsb3VkLmFmdGVyRmluZCgnTXlDdXN0b21DbGFzcycsIGFzeW5jIChyZXF1ZXN0KSA9PiB7XG4gKiAgIC8vIGNvZGUgaGVyZVxuICogfSlcbiAqXG4gKiBQYXJzZS5DbG91ZC5hZnRlckZpbmQoUGFyc2UuVXNlciwgYXN5bmMgKHJlcXVlc3QpID0+IHtcbiAqICAgLy8gY29kZSBoZXJlXG4gKiB9KVxuICpgYGBcbiAqXG4gKiBAbWV0aG9kIGFmdGVyRmluZFxuICogQG5hbWUgUGFyc2UuQ2xvdWQuYWZ0ZXJGaW5kXG4gKiBAcGFyYW0geyhTdHJpbmd8UGFyc2UuT2JqZWN0KX0gYXJnMSBUaGUgUGFyc2UuT2JqZWN0IHN1YmNsYXNzIHRvIHJlZ2lzdGVyIHRoZSBhZnRlciBmaW5kIGZ1bmN0aW9uIGZvci4gVGhpcyBjYW4gaW5zdGVhZCBiZSBhIFN0cmluZyB0aGF0IGlzIHRoZSBjbGFzc05hbWUgb2YgdGhlIHN1YmNsYXNzLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZnVuYyBUaGUgZnVuY3Rpb24gdG8gcnVuIGJlZm9yZSBhIGZpbmQuIFRoaXMgZnVuY3Rpb24gY2FuIGJlIGFzeW5jIGFuZCBzaG91bGQgdGFrZSBqdXN0IG9uZSBwYXJhbWV0ZXIsIHtAbGluayBQYXJzZS5DbG91ZC5BZnRlckZpbmRSZXF1ZXN0fS5cbiAqL1xuUGFyc2VDbG91ZC5hZnRlckZpbmQgPSBmdW5jdGlvbihwYXJzZUNsYXNzLCBoYW5kbGVyKSB7XG4gIGNvbnN0IGNsYXNzTmFtZSA9IGdldENsYXNzTmFtZShwYXJzZUNsYXNzKTtcbiAgdHJpZ2dlcnMuYWRkVHJpZ2dlcihcbiAgICB0cmlnZ2Vycy5UeXBlcy5hZnRlckZpbmQsXG4gICAgY2xhc3NOYW1lLFxuICAgIGhhbmRsZXIsXG4gICAgUGFyc2UuYXBwbGljYXRpb25JZFxuICApO1xufTtcblxuUGFyc2VDbG91ZC5vbkxpdmVRdWVyeUV2ZW50ID0gZnVuY3Rpb24oaGFuZGxlcikge1xuICB0cmlnZ2Vycy5hZGRMaXZlUXVlcnlFdmVudEhhbmRsZXIoaGFuZGxlciwgUGFyc2UuYXBwbGljYXRpb25JZCk7XG59O1xuXG5QYXJzZUNsb3VkLl9yZW1vdmVBbGxIb29rcyA9ICgpID0+IHtcbiAgdHJpZ2dlcnMuX3VucmVnaXN0ZXJBbGwoKTtcbn07XG5cblBhcnNlQ2xvdWQudXNlTWFzdGVyS2V5ID0gKCkgPT4ge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmVcbiAgY29uc29sZS53YXJuKFxuICAgICdQYXJzZS5DbG91ZC51c2VNYXN0ZXJLZXkgaXMgZGVwcmVjYXRlZCAoYW5kIGhhcyBubyBlZmZlY3QgYW55bW9yZSkgb24gcGFyc2Utc2VydmVyLCBwbGVhc2UgcmVmZXIgdG8gdGhlIGNsb3VkIGNvZGUgbWlncmF0aW9uIG5vdGVzOiBodHRwOi8vZG9jcy5wYXJzZXBsYXRmb3JtLm9yZy9wYXJzZS1zZXJ2ZXIvZ3VpZGUvI21hc3Rlci1rZXktbXVzdC1iZS1wYXNzZWQtZXhwbGljaXRseSdcbiAgKTtcbn07XG5cblBhcnNlQ2xvdWQuaHR0cFJlcXVlc3QgPSByZXF1aXJlKCcuL2h0dHBSZXF1ZXN0Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gUGFyc2VDbG91ZDtcblxuLyoqXG4gKiBAaW50ZXJmYWNlIFBhcnNlLkNsb3VkLlRyaWdnZXJSZXF1ZXN0XG4gKiBAcHJvcGVydHkge1N0cmluZ30gaW5zdGFsbGF0aW9uSWQgSWYgc2V0LCB0aGUgaW5zdGFsbGF0aW9uSWQgdHJpZ2dlcmluZyB0aGUgcmVxdWVzdC5cbiAqIEBwcm9wZXJ0eSB7Qm9vbGVhbn0gbWFzdGVyIElmIHRydWUsIG1lYW5zIHRoZSBtYXN0ZXIga2V5IHdhcyB1c2VkLlxuICogQHByb3BlcnR5IHtQYXJzZS5Vc2VyfSB1c2VyIElmIHNldCwgdGhlIHVzZXIgdGhhdCBtYWRlIHRoZSByZXF1ZXN0LlxuICogQHByb3BlcnR5IHtQYXJzZS5PYmplY3R9IG9iamVjdCBUaGUgb2JqZWN0IHRyaWdnZXJpbmcgdGhlIGhvb2suXG4gKiBAcHJvcGVydHkge1N0cmluZ30gaXAgVGhlIElQIGFkZHJlc3Mgb2YgdGhlIGNsaWVudCBtYWtpbmcgdGhlIHJlcXVlc3QuXG4gKiBAcHJvcGVydHkge09iamVjdH0gaGVhZGVycyBUaGUgb3JpZ2luYWwgSFRUUCBoZWFkZXJzIGZvciB0aGUgcmVxdWVzdC5cbiAqIEBwcm9wZXJ0eSB7U3RyaW5nfSB0cmlnZ2VyTmFtZSBUaGUgbmFtZSBvZiB0aGUgdHJpZ2dlciAoYGJlZm9yZVNhdmVgLCBgYWZ0ZXJTYXZlYCwgLi4uKVxuICogQHByb3BlcnR5IHtPYmplY3R9IGxvZyBUaGUgY3VycmVudCBsb2dnZXIgaW5zaWRlIFBhcnNlIFNlcnZlci5cbiAqIEBwcm9wZXJ0eSB7UGFyc2UuT2JqZWN0fSBvcmlnaW5hbCBJZiBzZXQsIHRoZSBvYmplY3QsIGFzIGN1cnJlbnRseSBzdG9yZWQuXG4gKi9cblxuLyoqXG4gKiBAaW50ZXJmYWNlIFBhcnNlLkNsb3VkLkJlZm9yZUZpbmRSZXF1ZXN0XG4gKiBAcHJvcGVydHkge1N0cmluZ30gaW5zdGFsbGF0aW9uSWQgSWYgc2V0LCB0aGUgaW5zdGFsbGF0aW9uSWQgdHJpZ2dlcmluZyB0aGUgcmVxdWVzdC5cbiAqIEBwcm9wZXJ0eSB7Qm9vbGVhbn0gbWFzdGVyIElmIHRydWUsIG1lYW5zIHRoZSBtYXN0ZXIga2V5IHdhcyB1c2VkLlxuICogQHByb3BlcnR5IHtQYXJzZS5Vc2VyfSB1c2VyIElmIHNldCwgdGhlIHVzZXIgdGhhdCBtYWRlIHRoZSByZXF1ZXN0LlxuICogQHByb3BlcnR5IHtQYXJzZS5RdWVyeX0gcXVlcnkgVGhlIHF1ZXJ5IHRyaWdnZXJpbmcgdGhlIGhvb2suXG4gKiBAcHJvcGVydHkge1N0cmluZ30gaXAgVGhlIElQIGFkZHJlc3Mgb2YgdGhlIGNsaWVudCBtYWtpbmcgdGhlIHJlcXVlc3QuXG4gKiBAcHJvcGVydHkge09iamVjdH0gaGVhZGVycyBUaGUgb3JpZ2luYWwgSFRUUCBoZWFkZXJzIGZvciB0aGUgcmVxdWVzdC5cbiAqIEBwcm9wZXJ0eSB7U3RyaW5nfSB0cmlnZ2VyTmFtZSBUaGUgbmFtZSBvZiB0aGUgdHJpZ2dlciAoYGJlZm9yZVNhdmVgLCBgYWZ0ZXJTYXZlYCwgLi4uKVxuICogQHByb3BlcnR5IHtPYmplY3R9IGxvZyBUaGUgY3VycmVudCBsb2dnZXIgaW5zaWRlIFBhcnNlIFNlcnZlci5cbiAqIEBwcm9wZXJ0eSB7Qm9vbGVhbn0gaXNHZXQgd2V0aGVyIHRoZSBxdWVyeSBhIGBnZXRgIG9yIGEgYGZpbmRgXG4gKi9cblxuLyoqXG4gKiBAaW50ZXJmYWNlIFBhcnNlLkNsb3VkLkFmdGVyRmluZFJlcXVlc3RcbiAqIEBwcm9wZXJ0eSB7U3RyaW5nfSBpbnN0YWxsYXRpb25JZCBJZiBzZXQsIHRoZSBpbnN0YWxsYXRpb25JZCB0cmlnZ2VyaW5nIHRoZSByZXF1ZXN0LlxuICogQHByb3BlcnR5IHtCb29sZWFufSBtYXN0ZXIgSWYgdHJ1ZSwgbWVhbnMgdGhlIG1hc3RlciBrZXkgd2FzIHVzZWQuXG4gKiBAcHJvcGVydHkge1BhcnNlLlVzZXJ9IHVzZXIgSWYgc2V0LCB0aGUgdXNlciB0aGF0IG1hZGUgdGhlIHJlcXVlc3QuXG4gKiBAcHJvcGVydHkge1BhcnNlLlF1ZXJ5fSBxdWVyeSBUaGUgcXVlcnkgdHJpZ2dlcmluZyB0aGUgaG9vay5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8UGFyc2UuT2JqZWN0Pn0gcmVzdWx0cyBUaGUgcmVzdWx0cyB0aGUgcXVlcnkgeWllbGRlZC5cbiAqIEBwcm9wZXJ0eSB7U3RyaW5nfSBpcCBUaGUgSVAgYWRkcmVzcyBvZiB0aGUgY2xpZW50IG1ha2luZyB0aGUgcmVxdWVzdC5cbiAqIEBwcm9wZXJ0eSB7T2JqZWN0fSBoZWFkZXJzIFRoZSBvcmlnaW5hbCBIVFRQIGhlYWRlcnMgZm9yIHRoZSByZXF1ZXN0LlxuICogQHByb3BlcnR5IHtTdHJpbmd9IHRyaWdnZXJOYW1lIFRoZSBuYW1lIG9mIHRoZSB0cmlnZ2VyIChgYmVmb3JlU2F2ZWAsIGBhZnRlclNhdmVgLCAuLi4pXG4gKiBAcHJvcGVydHkge09iamVjdH0gbG9nIFRoZSBjdXJyZW50IGxvZ2dlciBpbnNpZGUgUGFyc2UgU2VydmVyLlxuICovXG5cbi8qKlxuICogQGludGVyZmFjZSBQYXJzZS5DbG91ZC5GdW5jdGlvblJlcXVlc3RcbiAqIEBwcm9wZXJ0eSB7U3RyaW5nfSBpbnN0YWxsYXRpb25JZCBJZiBzZXQsIHRoZSBpbnN0YWxsYXRpb25JZCB0cmlnZ2VyaW5nIHRoZSByZXF1ZXN0LlxuICogQHByb3BlcnR5IHtCb29sZWFufSBtYXN0ZXIgSWYgdHJ1ZSwgbWVhbnMgdGhlIG1hc3RlciBrZXkgd2FzIHVzZWQuXG4gKiBAcHJvcGVydHkge1BhcnNlLlVzZXJ9IHVzZXIgSWYgc2V0LCB0aGUgdXNlciB0aGF0IG1hZGUgdGhlIHJlcXVlc3QuXG4gKiBAcHJvcGVydHkge09iamVjdH0gcGFyYW1zIFRoZSBwYXJhbXMgcGFzc2VkIHRvIHRoZSBjbG91ZCBmdW5jdGlvbi5cbiAqL1xuXG4vKipcbiAqIEBpbnRlcmZhY2UgUGFyc2UuQ2xvdWQuSm9iUmVxdWVzdFxuICogQHByb3BlcnR5IHtPYmplY3R9IHBhcmFtcyBUaGUgcGFyYW1zIHBhc3NlZCB0byB0aGUgYmFja2dyb3VuZCBqb2IuXG4gKiBAcHJvcGVydHkge2Z1bmN0aW9ufSBtZXNzYWdlIElmIG1lc3NhZ2UgaXMgY2FsbGVkIHdpdGggYSBzdHJpbmcgYXJndW1lbnQsIHdpbGwgdXBkYXRlIHRoZSBjdXJyZW50IG1lc3NhZ2UgdG8gYmUgc3RvcmVkIGluIHRoZSBqb2Igc3RhdHVzLlxuICovXG4iXX0=