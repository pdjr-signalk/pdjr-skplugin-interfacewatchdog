/**********************************************************************
 * Copyright 2018 Paul Reeve <paul@pdjr.eu>
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
const DebugLog = require("./lib/signalk-liblog/DebugLog.js");
const Schema = require("./lib/signalk-libschema/Schema.js");
const Notification = require("./lib/signalk-libnotification/Notification.js");

const PLUGIN_ID = "canwatchdog";
const PLUGIN_NAME = "CAN interface watchdog";
const PLUGIN_DESCRIPTION = "Monitor a CAN interface for anomalous changes in throughput";

const PLUGIN_SCHEMA_FILE = __dirname + "/schema.json";
const PLUGIN_UISCHEMA_FILE = __dirname + "/uischema.json";
const PLUGIN_DEBUG_TOKENS = [  ];

module.exports = function(app) {
  var plugin = {};

  plugin.id = PLUGIN_ID;
  plugin.name = PLUGIN_NAME;
  plugin.description = PLUGIN_DESCRIPTION;

  const log = new Log(plugin.id, { ncallback: app.setPluginStatus, ecallback: app.setPluginError });
  const notification = new Notification(app, plugin.id);

  plugin.schema = function() {
    var schema = Schema.createSchema(PLUGIN_SCHEMA_FILE);
    return(schema.getSchema());
  };

  plugin.uiSchema = function() {
    var schema = Schema.createSchema(PLUGIN_UISCHEMA_FILE);
    return(schema.getSchema());
  }

  plugin.start = function(options) {
    if (options) {
      if  (validateOptions(options)) {
        log.N("Watching '%s' (threshold = %d, reboot = %s)", options.interface, options.threshold, options.reboot);
        app.on('serverevent', (e) => {
          if ((e.type) && (e.type == "SERVERSTATISTICS")) {
	    if ((e.data) && (e.data.providerStatistics)) {
              if (e.data.providerStatistics[options.interface]) {
                if (e.data.providerStatistics[options.interface].deltaRate) {
		  if (e.data.providerStatistics[options.interface].deltaRate <= options.threshold) {
                    console.log(PLUGIN_ID + ": delta rate below trigger threshold");
                    if (options.reboot) {
                      console.log(PLUGIN_ID + ": restarting Signal K");
                    }
                  }
                }
              } else {
	        console.log(PLUGIN_ID + ": provider statistics are not available for interface '" + options.interface + "'");
              } 
            }
          }
        });
      } else {
        log.N("Invalid configuration");
      }
    }
  }

  plugin.stop = function() {
  }

  function validateOptions(options) {
    var retval = 0;
    if ((options.interface) && (options.interface != "")) {
      if (options.threshold >= 0) {
        retval = 1;
      }
    }
    return(1);
  }

  return(plugin);
}
