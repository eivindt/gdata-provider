import jestFetchMock from "jest-fetch-mock";
jestFetchMock.enableFetchMocks();

import { jest } from "@jest/globals";

import { WebExtListener, WebExtStorage } from "./utils";

import calGoogleCalendar from "../../src/background/calendar";
import gcalItems from "./fixtures/gcalItems.json";
import jcalItems from "./fixtures/jcalItems.json";
import v8 from "v8";
import ICAL from "ical.js";

function authenticate(session) {
  session.oauth.accessToken = "accessToken";
  session.oauth.expires = new Date(new Date().getTime() + 10000);
}

function mockCalendarRequest(req, props) {
  if (req.url.startsWith("https://www.googleapis.com/calendar/v3/calendars")) {
    return {
      headers: {
        Date: new Date(),
      },
      body: JSON.stringify(
        Object.assign(
          {
            kind: "calendar#events",
            etag: '"123123"',
            summary: "calendar1",
            description: "calendar1 descr",
            updated: new Date().toISOString(),
            timeZone: "Europe/Berlin",
            accessRole: "owner",
            defaultReminders: [{ method: "popup", minutes: 120 }],
            nextPageToken: null,
            nextSyncToken: "nextSyncToken",
            items: [],
          },
          props
        )
      ),
    };
  }
  return null;
}
function mockCalendarListRequest(req, props) {
  if (req.url.startsWith("https://www.googleapis.com/calendar/v3/users/me/calendarList")) {
    return {
      headers: {
        Date: new Date(),
      },
      body: JSON.stringify(
        Object.assign(
          {
            kind: "calendar#calendarListEntry",
            etag: '"123123"',
            id: "gid1",
            summary: "calendar1",
            summaryOverride: "calendar1override",
            description: "The calendar 1",
            location: "test",
            timeZone: "Europe/Berlin",
            colorId: 17,
            backgroundColor: "#000000",
            foregroundColor: "#FFFFFF",
            hidden: false,
            selected: false,
            accessRole: "owner",
            defaultReminders: [{ method: "popup", minutes: 120 }],
            notificationSettings: { notifications: [] },
            primary: true,
            deleted: false,
            conferenceProperties: { allowedConferenceSolutionTypes: [] },
          },
          props
        )
      ),
    };
  }
  return null;
}

function mockTaskRequest(req, props) {
  if (req.url.startsWith("https://www.googleapis.com/tasks/v1/lists/taskhash/tasks")) {
    return {
      headers: {
        Date: new Date(),
      },
      body: JSON.stringify(
        Object.assign(
          {
            kind: "tasks#tasks",
            etag: '"123123"',
            nextPageToken: null,
            items: [],
          },
          props
        )
      ),
    };
  }
  return null;
}

beforeEach(() => {
  global.messenger = {
    calendar: {
      calendars: {
        _calendars: {
          id0: { id: "id0", type: "ics", url: "https://example.com/feed.ics" },
          id1: {
            id: "id1",
            cacheId: "cached-id1",
            type: "gdata",
            url: "googleapi://sessionId/?calendar=id1%40calendar.google.com&tasks=taskhash",
          },
          id2: { id: "id2", cacheId: "cached-id2", type: "gdata", url: "googleapi://sessionId/" },
          id3: {
            id: "id3",
            cacheId: "cached-id3",
            type: "gdata",
            url: "googleapi://sessionId@group.calendar.google.com/",
          },
          id4: {
            id: "id4",
            cacheId: "cached-id4",
            type: "gdata",
            url: "https://www.google.com/calendar/ical/sessionId/private/full",
          },
          id5: {
            id: "id5",
            cacheId: "cached-id5",
            type: "gdata",
            url: "https://www.google.com/calendar/feeds/user%40example.com/public/full",
          },
          id6: { id: "id6", cacheId: "cached-id6", type: "gdata", url: "wat://" },
        },
        get: jest.fn(async id => {
          return messenger.calendar.calendars._calendars[id];
        }),
        update: jest.fn(async (id, update) => {
          let calendar = messenger.calendar.calendars._calendars;
          Object.assign(calendar, update);
          return calendar;
        }),
        clear: jest.fn(),
      },
      provider: {
        onFreeBusy: new WebExtListener(false),
      },
    },
    gdata: {
      getOAuthToken: async function() {
        return "accessToken";
      },

      setOAuthToken: async function() {},
    },
    i18n: {
      getMessage: function(key, ...args) {
        return `${key}[${args.join(",")}]`;
      },
    },

    storage: {
      local: new WebExtStorage(),
    },
    idle: {
      _idleState: "active",
      queryState: jest.fn(async () => {
        return messenger.idle._idleState;
      }),
    },
  };

  jest.spyOn(global.console, "log").mockImplementation(() => {});
  jest.spyOn(global.console, "error").mockImplementation(() => {});
});

test("static init", async () => {
  let gcal = await calGoogleCalendar.get("id1");

  expect(gcal.id).toBe("id1");
  expect(gcal.cacheId).toBe("cached-id1");

  let gcal2 = await calGoogleCalendar.get("id1");
  expect(gcal2).toBe(gcal);

  await expect(calGoogleCalendar.get("id0")).rejects.toThrow(/invalid calendar type/);
});

test("initListeners", async () => {
  function prepareMock(method, ...args) {
    messenger.calendar.provider[method] = new WebExtListener();
    jest.spyOn(calendar, method).mockImplementation(() => {});
  }

  let rawId1 = messenger.calendar.calendars._calendars.id1;
  let calendar = await calGoogleCalendar.get("id1");
  let called = {};

  prepareMock("onItemCreated", rawId1, { id: "item" });
  prepareMock("onItemUpdated", rawId1, { id: "item", title: "new" }, { id: "item", title: "old" });
  prepareMock("onItemRemoved", rawId1, { id: "item" });
  prepareMock("onInit", rawId1);
  prepareMock("onSync", rawId1);
  prepareMock("onResetSync", rawId1);

  calGoogleCalendar.initListeners();

  expect(messenger.calendar.provider.onItemCreated.addListener).toHaveBeenCalled();
  expect(messenger.calendar.provider.onItemUpdated.addListener).toHaveBeenCalled();
  expect(messenger.calendar.provider.onItemRemoved.addListener).toHaveBeenCalled();
  expect(messenger.calendar.provider.onInit.addListener).toHaveBeenCalled();
  expect(messenger.calendar.provider.onSync.addListener).toHaveBeenCalled();
  expect(messenger.calendar.provider.onResetSync.addListener).toHaveBeenCalled();

  await messenger.calendar.provider.onItemCreated.mockResponse(rawId1, { id: "item" });
  expect(calendar.onItemCreated).toHaveBeenCalledWith({ id: "item" });

  await messenger.calendar.provider.onItemUpdated.mockResponse(
    rawId1,
    { id: "item", title: "new" },
    { id: "item", title: "old" }
  );
  expect(calendar.onItemUpdated).toHaveBeenCalledWith(
    { id: "item", title: "new" },
    { id: "item", title: "old" }
  );

  await messenger.calendar.provider.onItemRemoved.mockResponse(rawId1, { id: "item" });
  expect(calendar.onItemRemoved).toHaveBeenCalledWith({ id: "item" });

  await messenger.calendar.provider.onInit.mockResponse(rawId1);
  expect(calendar.onInit).toHaveBeenCalledWith();

  await messenger.calendar.provider.onSync.mockResponse(rawId1);
  expect(calendar.onSync).toHaveBeenCalledWith();

  await messenger.calendar.provider.onResetSync.mockResponse(rawId1);
  expect(calendar.onResetSync).toHaveBeenCalledWith();
});

test("onInit", async () => {
  let calendar = await calGoogleCalendar.get("id1");
  await calendar.onInit();

  expect(global.messenger.calendar.calendars.update).toHaveBeenLastCalledWith("id1", {
    capabilities: {
      organizer: "id1@calendar.google.com",
    },
  });

  expect(calendar.calendarName).toBe("id1@calendar.google.com");
  expect(calendar.tasklistName).toBe("taskhash");

  calendar = await calGoogleCalendar.get("id2");
  await calendar.onInit();
  expect(calendar.calendarName).toBe("sessionId");
  expect(calendar.tasklistName).toBe("@default");

  calendar = await calGoogleCalendar.get("id3");
  await calendar.onInit();
  expect(calendar.calendarName).toBe("sessionId@group.calendar.google.com");
  expect(calendar.tasklistName).toBeFalsy();

  calendar = await calGoogleCalendar.get("id4");
  await calendar.onInit();
  expect(calendar.calendarName).toBe("sessionId");
  expect(calendar.tasklistName).toBeFalsy();

  await messenger.storage.local.set({ "googleUser.user@example.com": "user@example.com" });
  calendar = await calGoogleCalendar.get("id5");
  await calendar.onInit();
  expect(calendar.calendarName).toBe("user@example.com");
  expect(calendar.tasklistName).toEqual("@default");

  calendar = await calGoogleCalendar.get("id6");
  await calendar.onInit();
  expect(calendar.calendarName).toBeFalsy();
  expect(calendar.tasklistName).toBeFalsy();
});

test("create uris", async () => {
  let calendar = await calGoogleCalendar.get("id6");
  expect(calendar.createEventsURI("part1")).toBe(null);
  expect(calendar.createTasksURI("part1")).toBe(null);

  calendar = await calGoogleCalendar.get("id1");
  expect(calendar.createEventsURI("part1", "part2")).toBe(
    "https://www.googleapis.com/calendar/v3/calendars/id1%40calendar.google.com/part1/part2"
  );
  expect(calendar.createTasksURI("part1", "part2")).toBe(
    "https://www.googleapis.com/tasks/v1/lists/taskhash/part1/part2"
  );

  expect(calendar.createUsersURI("part=1", "part2")).toBe(
    "https://www.googleapis.com/calendar/v3/users/me/part%3D1/part2"
  );
});

test("calendar prefs", async () => {
  let calendar = await calGoogleCalendar.get("id1");

  let pref = await calendar.getCalendarPref("foo", "default");
  expect(pref).toBe("default");
  pref = await calendar.getCalendarPref("foo");
  expect(pref).toBe(null);

  await calendar.setCalendarPref("foo", "bar");
  expect(await messenger.storage.local.get({ "calendars.id1.foo": null })).toEqual({
    "calendars.id1.foo": "bar",
  });
  expect(await calendar.getCalendarPref("foo", "default")).toBe("bar");
});

test("updated min", async () => {
  let calendar = await calGoogleCalendar.get("id1");

  expect(await calendar.getUpdatedMin()).toBeFalsy();

  let newUpdate = new Date();
  await calendar.setCalendarPref("tasksLastUpdated", newUpdate.toISOString());
  expect(await calendar.getUpdatedMin()).toEqual(newUpdate);

  newUpdate = new Date(new Date() - 86400 * 8 * 1000);
  await calendar.setCalendarPref("tasksLastUpdated", newUpdate.toISOString());
  expect(await calendar.getUpdatedMin()).toBe(null);
  expect(messenger.calendar.calendars.clear).toHaveBeenCalledWith("cached-id1");
});

describe("item functions", () => {
  let calendar;

  beforeEach(async () => {
    jestFetchMock.doMock();
    calendar = await calGoogleCalendar.get("id1");
    await calendar.onInit();
    authenticate(calendar.session);
  });
  describe("events", () => {
    test.each([false, true])("onItemCreated success sendUpdates=%s", async sendUpdates => {
      await messenger.storage.local.set({ "settings.sendEventNotifications": sendUpdates });

      fetch.mockResponse(req => {
        if (
          req.url.startsWith(
            "https://www.googleapis.com/calendar/v3/calendars/id1%40calendar.google.com/events"
          )
        ) {
          // remove alarms in response
          let gcalItemResponse = v8.deserialize(v8.serialize(gcalItems[0]));
          delete gcalItemResponse.reminders.overrides;

          return {
            body: JSON.stringify(gcalItemResponse),
          };
        }
        throw new Error("Unhandled request " + req.url);
      });

      let newItem = v8.deserialize(v8.serialize(jcalItems[0]));
      let expected = v8.deserialize(v8.serialize(jcalItems[0]));

      // remove alarms
      new ICAL.Component(newItem.formats.jcal)
        .getFirstSubcomponent("vevent")
        .removeAllSubcomponents("valarm");
      new ICAL.Component(expected.formats.jcal)
        .getFirstSubcomponent("vevent")
        .removeAllSubcomponents("valarm");

      // vcalendar -> vevent
      expected.formats.jcal = expected.formats.jcal[2][0];

      let item = await calendar.onItemCreated(newItem);

      expect(item).toEqual(expected);
      expect(fetch).toHaveBeenCalledWith(
        new URL(
          "https://www.googleapis.com/calendar/v3/calendars/id1%40calendar.google.com/events" +
            (sendUpdates ? "?sendUpdates=all" : "")
        ),
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    test.each([false, true])("onItemUpdated success sendUpdates=%s", async sendUpdates => {
      await messenger.storage.local.set({ "settings.sendEventNotifications": sendUpdates });

      fetch.mockResponse(req => {
        if (
          req.url.startsWith(
            "https://www.googleapis.com/calendar/v3/calendars/id1%40calendar.google.com/events/go6ijb0b46hlpbu4eeu92njevo"
          )
        ) {
          return {
            body: JSON.stringify(gcalItems[0]),
          };
        }
        throw new Error("Unhandled request " + req.url);
      });

      let oldItem = v8.deserialize(v8.serialize(jcalItems[0]));
      let newItem = v8.deserialize(v8.serialize(jcalItems[0]));

      if (!sendUpdates) {
        // Using this condition also to check the branch without an etag
        delete oldItem.metadata.etag;
      }

      let vevent = new ICAL.Component(newItem.formats.jcal);
      vevent
        .getFirstSubcomponent("vevent")
        .getFirstProperty("summary")
        .setValue("changed");

      let result = await calendar.onItemUpdated(newItem, oldItem);

      expect(fetch).toHaveBeenCalledWith(
        new URL(
          "https://www.googleapis.com/calendar/v3/calendars/id1%40calendar.google.com/events/go6ijb0b46hlpbu4eeu92njevo" +
            (sendUpdates ? "?sendUpdates=all" : "")
        ),
        expect.objectContaining({
          method: "PATCH",
          body: '{"summary":"changed"}',
          headers: expect.objectContaining({
            "If-Match": sendUpdates ? '"2299601498276000"' : "*",
          }),
        })
      );
    });

    test.each([false, true])("onItemRemoved success sendUpdates=%s", async sendUpdates => {
      await messenger.storage.local.set({ "settings.sendEventNotifications": sendUpdates });

      fetch.mockResponse(req => {
        if (
          req.url.startsWith(
            "https://www.googleapis.com/calendar/v3/calendars/id1%40calendar.google.com/events/go6ijb0b46hlpbu4eeu92njevo"
          )
        ) {
          return {
            status: 204,
            headers: {
              "Content-Length": 0,
            },
          };
        }
        throw new Error("Unhandled request " + req.url);
      });

      let removedItem = v8.deserialize(v8.serialize(jcalItems[0]));

      if (!sendUpdates) {
        // Using this also to check the branch without an etag
        delete removedItem.metadata.etag;
      }

      let item = await calendar.onItemRemoved(removedItem);

      // vcalendar -> vevent
      expect(fetch).toHaveBeenCalledWith(
        new URL(
          "https://www.googleapis.com/calendar/v3/calendars/id1%40calendar.google.com/events/go6ijb0b46hlpbu4eeu92njevo" +
            (sendUpdates ? "?sendUpdates=all" : "")
        ),
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            "If-Match": sendUpdates ? '"2299601498276000"' : "*",
          }),
        })
      );
    });
  });

  describe("tasks", () => {
    test("onItemCreated", async () => {
      fetch.mockResponse(req => {
        if (req.url.startsWith("https://www.googleapis.com/tasks/v1/lists/taskhash/tasks")) {
          return {
            body: JSON.stringify(gcalItems[2]),
          };
        }
        throw new Error("Unhandled request " + req.url);
      });

      expect(jcalItems[3].id).toBe("lqohjsbhqoztdkusnpruvooacn");

      let item = await calendar.onItemCreated(jcalItems[3]);
      let jcal = new ICAL.Component(item.formats.jcal);

      expect(jcal.name).toBe("vtodo");
      expect(item.metadata.etag).toBe('"2128312983238480"');
      expect(item.metadata.path).toBe("lqohjsbhqoztdkusnpruvooacn");
      expect(item.title).toBe("New Task");
      expect(jcal.getFirstPropertyValue("summary")).toBe("New Task");
      expect(jcal.getFirstPropertyValue("last-modified").toICALString()).toBe("20060608T210549"); // TODO this is floating, ical.js bug?
      expect(jcal.getFirstPropertyValue("dtstamp").toICALString()).toBe("20060608T210549"); // TODO this is floating, ical.js bug?
      expect(jcal.getFirstPropertyValue("url")).toBe(
        "https://example.com/calendar/task?eid=taskhash"
      );
      expect(jcal.getFirstPropertyValue("related-to")).toBe("parentId");
      expect(jcal.getFirstProperty("related-to").getParameter("reltype")).toBe("PARENT");
      expect(jcal.getFirstPropertyValue("x-google-sortkey")).toBe(12312);
      expect(jcal.getFirstPropertyValue("description")).toBe("description");
      expect(jcal.getFirstPropertyValue("status")).toBe("COMPLETED");
      expect(jcal.getFirstPropertyValue("due").toICALString()).toBe("20060610T180000"); // TODO this is floating, ical.js bug?
      expect(jcal.getFirstPropertyValue("completed").toICALString()).toBe("20060611T180000"); // TODO this is floating, ical.js bug?
      expect(jcal.getFirstPropertyValue("attach")).toBe("https://example.com/filename.pdf");
      expect(jcal.getFirstProperty("attach").getParameter("filename")).toBe("filename.pdf");
      expect(jcal.getFirstProperty("attach").getParameter("x-google-type")).toBe("href");
    });

    test("onItemUpdated", async () => {
      fetch.mockResponse(req => {
        if (
          req.url.startsWith(
            "https://www.googleapis.com/tasks/v1/lists/taskhash/tasks/lqohjsbhqoztdkusnpruvooacn"
          )
        ) {
          return {
            body: JSON.stringify(gcalItems[0]),
          };
        }
        throw new Error("Unhandled request " + req.url);
      });

      let oldItem = jcalItems[3];
      let newItem = v8.deserialize(v8.serialize(jcalItems[3]));

      expect(oldItem.id).toBe("lqohjsbhqoztdkusnpruvooacn");

      let vcalendar = new ICAL.Component(newItem.formats.jcal);
      vcalendar
        .getFirstSubcomponent("vtodo")
        .getFirstProperty("summary")
        .setValue("changed");

      let result = await calendar.onItemUpdated(newItem, oldItem);

      expect(fetch).toHaveBeenCalledWith(
        new URL(
          "https://www.googleapis.com/tasks/v1/lists/taskhash/tasks/lqohjsbhqoztdkusnpruvooacn"
        ),
        expect.objectContaining({
          method: "PATCH",
          body: '{"title":"changed"}',
        })
      );
    });
    test("onItemRemoved", async () => {
      fetch.mockResponse(req => {
        if (
          req.url.startsWith(
            "https://www.googleapis.com/tasks/v1/lists/taskhash/tasks/lqohjsbhqoztdkusnpruvooacn"
          )
        ) {
          return {
            status: 204,
            headers: {
              "Content-Length": 0,
            },
          };
        }
        throw new Error("Unhandled request " + req.url);
      });

      let item = await calendar.onItemRemoved(jcalItems[3]);

      // vcalendar -> vevent
      expect(fetch).toHaveBeenCalledWith(
        new URL(
          "https://www.googleapis.com/tasks/v1/lists/taskhash/tasks/lqohjsbhqoztdkusnpruvooacn"
        ),
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });
  });

  test("invalid", async () => {
    let newItem = v8.deserialize(v8.serialize(jcalItems[0]));
    newItem.type = "wat";
    await expect(calendar.onItemRemoved(newItem)).rejects.toThrow("Unknown item type: wat");
  });
});

describe("onSync", () => {
  test.each(["owner", "freeBusyReader"])("accessRole=%s", async accessRole => {
    jestFetchMock.doMock();

    let calendar = await calGoogleCalendar.get("id1");
    await calendar.onInit();

    messenger.idle._idleState = "inactive";
    await calendar.onSync();
    expect(console.log).toHaveBeenCalledWith(
      "[calGoogleCalendar]",
      "Skipping refresh since user is idle"
    );
    expect(fetch).not.toHaveBeenCalled();

    messenger.idle._idleState = "active";

    fetch.mockResponse(req => {
      let response;

      if ((response = mockCalendarRequest(req)) !== null) {
        return response;
      }
      if ((response = mockCalendarListRequest(req, { accessRole })) !== null) {
        return response;
      }
      if ((response = mockTaskRequest(req)) !== null) {
        return response;
      }

      throw new Error("Unhandled request " + req.url);
    });

    calendar.session.oauth.accessToken = "accessToken";
    calendar.session.oauth.expires = new Date(new Date().getTime() + 10000);
    await calendar.onSync();

    expect(await calendar.getCalendarPref("eventSyncToken")).toBe("nextSyncToken");
    expect(await calendar.getCalendarPref("settings.accessRole")).toBe(accessRole);
    expect(await calendar.getCalendarPref("settings.backgroundColor")).toBe("#000000");
    expect(await calendar.getCalendarPref("settings.foregroundColor")).toBe("#FFFFFF");
    expect(await calendar.getCalendarPref("settings.description")).toBe("The calendar 1");
    expect(await calendar.getCalendarPref("settings.location")).toBe("test");
    expect(await calendar.getCalendarPref("settings.primary")).toBe(true);
    expect(await calendar.getCalendarPref("settings.summary")).toBe("calendar1");
    expect(await calendar.getCalendarPref("settings.summaryOverride")).toBe("calendar1override");
    expect(await calendar.getCalendarPref("settings.timeZone")).toBe("Europe/Berlin");
    expect(await calendar.getCalendarPref("settings.defaultReminders")).toBe(
      '[{"method":"popup","minutes":120}]'
    );

    if (accessRole == "freeBusyReader") {
      expect(messenger.calendar.calendars.update).toHaveBeenCalledWith("id1", { readOnly: true });
    }
  });

  test("reset sync", async () => {
    jestFetchMock.doMock();
    let calendar = await calGoogleCalendar.get("id1");
    await calendar.onInit();

    let hasCleared = false;
    let hasCalledTwice = false;
    fetch.mockResponse(req => {
      let response;

      if (req.url.startsWith("https://www.googleapis.com/calendar/v3/calendars")) {
        if (hasCleared) {
          hasCalledTwice = true;
          return mockCalendarRequest(req);
        } else {
          // RESOURCE_GONE
          hasCleared = true;
          return {
            headers: {
              "Content-Length": 0,
            },
            status: 410,
          };
        }
      }
      if ((response = mockCalendarListRequest(req)) !== null) {
        return response;
      }
      if ((response = mockTaskRequest(req)) !== null) {
        return response;
      }

      throw new Error("Unhandled request " + req.url);
    });

    authenticate(calendar.session);
    await calendar.onSync();

    expect(messenger.calendar.calendars.clear).toHaveBeenCalledTimes(1);
    expect(messenger.calendar.calendars.clear).toHaveBeenCalledWith("cached-id1");
    expect(hasCalledTwice).toBe(true);
  });

  test("fail", async () => {
    jestFetchMock.doMock();
    let calendar = await calGoogleCalendar.get("id1");
    await calendar.onInit();

    fetch.mockResponse("blergh");

    authenticate(calendar.session);
    expect(calendar.onSync()).rejects.toThrow(/invalid json response/);

    expect(messenger.calendar.calendars.clear).not.toHaveBeenCalled();
  });
});
