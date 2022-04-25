/**********************************************************************
 * Copyright 2022 Paul Reeve <preeve@pdjr.eu>
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you
 * may not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
 * implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

const Log = require("./lib/signalk-liblog/Log.js");
const Schema = require("./lib/signalk-libschema/Schema.js");
const Notification = require("./lib/signalk-libnotification/Notification.js");

const PLUGIN_ID = "interfacewatchdog";
const PLUGIN_NAME = "Signal K interface activity watchdog";
const PLUGIN_DESCRIPTION = "Monitor a Signal K interface for anomalous changes in throughput";

const PLUGIN_SCHEMA_FILE = __dirname + "/schema.json";
const PLUGIN_UISCHEMA_FILE = __dirname + "/uischema.json";
const PLUGIN_DEBUG_TOKENS = [  ];

module.exports = function(app) {
  var plugin = {};

  plugin.id = PLUGIN_ID;
  plugin.name = PLUGIN_NAME;
  plugin.description = PLUGIN_DESCRIPTION;

  const log = new Log(plugin.id, { ncallback: app.setPluginStatus, ecallback: app.setPluginError });
  const notification = new Notification(app, plugin.id, { "state": "alarm", "method": [ ] });

  plugin.schema = function() {
    var schema = Schema.createSchema(PLUGIN_SCHEMA_FILE);
    return(schema.getSchema());
  };

  plugin.uiSchema = function() {
    var schema = Schema.createSchema(PLUGIN_UISCHEMA_FILE);
    return(schema.getSchema());
  }

  plugin.start = function(options) {
    var issued = 0;

    if (options) {
      log.N("Watching '%s' (threshold = %d, reboot = %s)", options.interface, options.threshold, options.reboot);
      notification.cancel(options.notificationpath);
      app.on('serverevent', (e) => {
        if ((e.type) && (e.type == "SERVERSTATISTICS")) {
          if (e.data.providerStatistics[options.interface].deltaRate !== undefined) {
	    if (parseInt(e.data.providerStatistics[options.interface].deltaRate) <= options.threshold) {
              console.log(PLUGIN_ID + ": delta rate at or below trigger threshold");
              if (!issued) {
                notification.issue(options.notificationpath, "Throughput on '" + options.interface + "' dropped below threshold");
	        issued = 1;
	      }
              if (options.reboot) {
                console.log(PLUGIN_ID + ": restarting Signal K");
	        process.exit(0);
              } 
            } else {
              if (issued) {
                notification.cancel(options.notificationpath);
		issued = 0;
	      }
            }
          }
        }
      });
    } else {
      log.E("bad or missing configuration");
    }
  }

  plugin.stop = function() {
  }

  return(plugin);
}
