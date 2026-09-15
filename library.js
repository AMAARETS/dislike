'use strict';

const Notifications = require.main.require('./src/notifications');
const User = require.main.require('./src/user');
const Groups = require.main.require('./src/groups');
const Posts = require.main.require('./src/posts');
const websockets = require.main.require('./src/socket.io');

const plugin = {};
const STAFF_GROUPS = ['administrators', 'הנוטרים'];

// פונקציית עזר לעדכון מספר ההתראות באייקון בזמן אמת
async function updateUnreadCount(uids) {
    if (!uids || !uids.length) return;
    uids = Array.isArray(uids) ? uids : [uids];

    await Promise.all(uids.map(async (uid) => {
        const count = await User.notifications.getUnreadCount(uid);
        // שליחת עדכון לסוקט של המשתמש הספציפי
        websockets.in(`uid_${uid}`).emit('event:notifications.updateCount', count);
    }));
}

// ה-nid נגזר מנותן הדיסלייק ומהפוסט בלבד, כדי שניתן יהיה לשחזר אותו בביטול ההצבעה
function getNid(type, voterUid, pid) {
    return `dislike-notifier:${type}:${voterUid}:${pid}`;
}

async function getStaffUids(excludeUid) {
    const groupMembersArrays = await Promise.all(
        STAFF_GROUPS.map(name => Groups.getMembers(name, 0, -1))
    );
    // איחוד והמרת כל ה-IDs למספרים כדי למנוע בעיות השוואה
    const uids = [...new Set(groupMembersArrays.flat())].map(uid => parseInt(uid, 10));
    return uids.filter(uid => uid !== excludeUid);
}

plugin.notifiDown = async function (data) {
    const voterUid = parseInt(data.uid, 10);
    const ownerUid = parseInt(data.owner, 10);
    const { pid } = data;

    try {
        const [voterName, ownerName] = await Promise.all([
            User.getUserField(voterUid, 'username'),
            User.getUserField(ownerUid, 'username'),
        ]);

        const postPath = `/post/${pid}`;

        // 1. התראה לנותן הדיסלייק
        const voterNotif = await Notifications.create({
            bodyShort: `נתת דיסלייק למשתמש ${ownerName}`,
            nid: getNid('voter', voterUid, pid),
            from: voterUid,
            path: postPath,
        });
        if (voterNotif) {
            await Notifications.push(voterNotif, [voterUid]);
        }

        // 2. התראה למקבל הדיסלייק
        if (voterUid !== ownerUid) {
            const ownerNotif = await Notifications.create({
                bodyShort: `קיבלת דיסלייק על פוסט שפרסמת`,
                nid: getNid('target', voterUid, pid),
                path: postPath,
            });
            if (ownerNotif) {
                await Notifications.push(ownerNotif, [ownerUid]);
            }
        }

        // 3. התראה לצוות (אדמינים ונוטרים), למעט נותן הדיסלייק עצמו
        const staffUids = await getStaffUids(voterUid);
        if (staffUids.length) {
            const staffNotif = await Notifications.create({
                bodyShort: `דיסלייק: ${voterName} -> ${ownerName}`,
                bodyLong: `המשתמש ${voterName} נתן דיסלייק לפוסט של ${ownerName}`,
                nid: getNid('staff', voterUid, pid),
                from: voterUid,
                path: postPath,
            });
            if (staffNotif) {
                await Notifications.push(staffNotif, staffUids);
            }
        }
    } catch (err) {
        console.error('[plugin-dislike-notifier] Error:', err);
    }
};

async function rescindDislikeNotifications(data) {
    const voterUid = parseInt(data.uid, 10);
    const { pid } = data;

    try {
        const nids = ['voter', 'target', 'staff'].map(type => getNid(type, voterUid, pid));
        await Notifications.rescind(nids);

        // עדכון המונה אצל כל מי שקיבל את ההתראות שבוטלו
        const [ownerUid, staffUids] = await Promise.all([
            Posts.getPostField(pid, 'uid'),
            getStaffUids(voterUid),
        ]);
        await updateUnreadCount([...new Set([voterUid, parseInt(ownerUid, 10), ...staffUids])]);
    } catch (err) {
        console.error('[plugin-dislike-notifier] Error during unvote:', err);
    }
}

// ביטול הצבעה: action:post.unvote נורה גם על ביטול לייק, ולכן בודקים מה הייתה ההצבעה הקודמת
plugin.notifiUnvote = async function (data) {
    if (data.current !== 'downvote') {
        return;
    }
    await rescindDislikeNotifications(data);
};

// מעבר ישיר מדיסלייק ללייק אינו יורה unvote אלא upvote עם current === 'downvote'
plugin.notifiUpvote = async function (data) {
    if (data.current !== 'downvote') {
        return;
    }
    await rescindDislikeNotifications(data);
};

module.exports = plugin;
