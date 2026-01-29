'use strict';

const Notifications = require.main.require('./src/notifications');
const User = require.main.require('./src/user');
const Groups = require.main.require('./src/groups');
const Posts = require.main.require('./src/posts');
const socketIndex = require.main.require('./src/socket.io/index');

const plugin = {};

// פונקציית עזר לעדכון מספר ההתראות באייקון בזמן אמת
async function updateUnreadCount(uids) {
    if (!uids || !uids.length) return;
    uids = Array.isArray(uids) ? uids : [uids];
    
    await Promise.all(uids.map(async (uid) => {
        const count = await Notifications.getUnreadCount(uid);
        // שליחת עדכון לסוקט של המשתמש הספציפי
        socketIndex.in(`uid:${uid}`).emit('event:notifications.updateCount', count);
        socketIndex.in(`uid:${uid}`).emit('event:unread.updateCount', count);
    }));
}

function getNid(type, uid, pid) {
    return `dislike-notifier:${type}:${uid}:${pid}`;
}

async function getStaffUids() {
    const groupNames = ['administrators', 'הנוטרים'];
    const groupMembersArrays = await Promise.all(
        groupNames.map(name => Groups.getMembers(name, 0, -1))
    );
    // איחוד והמרת כל ה-IDs למספרים כדי למנוע בעיות השוואה
    return [...new Set(groupMembersArrays.flat())].map(uid => parseInt(uid, 10));
}

plugin.notifiDown = async function (data) {
    const { uid, owner, pid } = data;
    const voterUid = parseInt(uid, 10);
    const ownerUid = parseInt(owner, 10);

    try {
        const [voterName, ownerName] = await Promise.all([
            User.getUserField(voterUid, 'username'),
            User.getUserField(ownerUid, 'username')
        ]);

        const postPath = `/post/${pid}`;
        const timestamp = Date.now();

        // 1. התראה לנותן הדיסלייק
        const voterNid = getNid('voter', voterUid, pid);
        const voterNotif = await Notifications.create({
            bodyShort: `נתת דיסלייק למשתמש ${ownerName}`,
            nid: voterNid,
            from: voterUid,
            path: postPath,
        });
        if (voterNotif) {
            await Notifications.push(voterNotif, [voterUid]);
        }

        // 2. התראה למקבל הדיסלייק
        if (voterUid !== ownerUid) {
            const ownerNid = getNid('target', ownerUid, pid);
            const ownerNotif = await Notifications.create({
                bodyShort: `קיבלת דיסלייק על פוסט שפרסמת`,
                nid: ownerNid,
                path: postPath,
            });
            if (ownerNotif) {
                await Notifications.push(ownerNotif, [ownerUid]);
            }
        }

        // 3. התראה לצוות (אדמינים ונוטרים)
        let staffUids = await getStaffUids();
        // סינון: הסרת נותן הדיסלייק מרשימת הצוות כדי שלא יקבל התראה כפולה
        staffUids = staffUids.filter(sUid => sUid !== voterUid);

        if (staffUids.length > 0) {
            const staffNid = getNid('staff', voterUid, pid);
            const staffNotif = await Notifications.create({
                bodyShort: `דיסלייק: ${voterName} -> ${ownerName}`,
                bodyLong: `המשתמש ${voterName} נתן דיסלייק לפוסט של ${ownerName}`,
                nid: staffNid,
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

plugin.notifiUnvote = async function (data) {
    const { uid, pid } = data;
    const voterUid = parseInt(uid, 10);

    try {
        const ownerUid = await Posts.getPostField(pid, 'uid');
        const staffUids = await getStaffUids();

        const nidsToRescind = [
            getNid('voter', voterUid, pid),
            getNid('target', ownerUid, pid),
            getNid('staff', voterUid, pid)
        ];

        // ביטול ההתראות מהדאטה-בייס
        await Promise.all(nidsToRescind.map(nid => Notifications.rescind(nid)));

        // עדכון כוחני של ה-UI לכל מי שהיה מעורב
        const uidsToUpdate = [...new Set([voterUid, parseInt(ownerUid, 10), ...staffUids])];
        await updateUnreadCount(uidsToUpdate);

    } catch (err) {
        console.error('[plugin-dislike-notifier] Error during unvote:', err);
    }
};

module.exports = plugin;