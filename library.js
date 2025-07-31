'use strict';
const Notifications = require.main.require('./src/notifications');
const User = require.main.require('./src/user');
const plugin = {};


plugin.notifiDown = async function (data) {
    let ownerName = await User.getUserField(data.owner, 'username');
    Notifications.create({
        bodyShort: `נתת דיסלייק למשתמש ${ownerName}`,
        bodyLong: '',
        nid: `dislike-notifier-${data.uid}-${Date.now()}`,
        from: data.uid,
        path: `/post/${data.pid}`,
    }, (err, Notification) => {
        if (!err && Notification) {
            Notifications.push(Notification, [data.uid]);
        }
    });
}

module.exports = plugin;