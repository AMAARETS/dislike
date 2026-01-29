'use strict';

const Notifications = require.main.require('./src/notifications');
const User = require.main.require('./src/user');
const Groups = require.main.require('./src/groups');
const Posts = require.main.require('./src/posts'); // נדרש כדי למצוא את בעל הפוסט בביטול
const plugin = {};

// פונקציית עזר ליצירת מזהה התראה קבוע
function getNid(type, uid, pid) {
    return `dislike-notifier:${type}:${uid}:${pid}`;
}

// פונקציית עזר למציאת חברי צוות
async function getStaffUids() {
    const groupNames = ['administrators', 'הנוטרים'];
    const groupMembersArrays = await Promise.all(
        groupNames.map(name => Groups.getMembers(name, 0, -1))
    );
    return [...new Set(groupMembersArrays.flat())];
}

plugin.notifiDown = async function (data) {
    const { uid, owner, pid } = data;

    try {
        const [voterName, ownerName] = await Promise.all([
            User.getUserField(uid, 'username'),
            User.getUserField(owner, 'username')
        ]);

        const postPath = `/post/${pid}`;

        // 1. התראה לנותן
        const voterNid = getNid('voter', uid, pid);
        const voterNotif = await Notifications.create({
            bodyShort: `נתת דיסלייק למשתמש ${ownerName}`,
            nid: voterNid,
            from: uid,
            path: postPath,
        });
        if (voterNotif) Notifications.push(voterNotif, [uid]);

        // 2. התראה למקבל (אנונימית)
        if (uid !== owner) {
            const ownerNid = getNid('target', owner, pid);
            const ownerNotif = await Notifications.create({
                bodyShort: `קיבלת דיסלייק על פוסט שפרסמת`,
                nid: ownerNid,
                path: postPath,
            });
            if (ownerNotif) Notifications.push(ownerNotif, [owner]);
        }

        // 3. התראה לצוות
        const staffUids = (await getStaffUids()).filter(sUid => sUid !== uid);
        if (staffUids.length > 0) {
            const staffNid = getNid('staff', pid, uid); // מזהה ייחודי לשילוב של הנותן והפוסט
            const staffNotif = await Notifications.create({
                bodyShort: `דיסלייק: ${voterName} -> ${ownerName}`,
                bodyLong: `המשתמש ${voterName} נתן דיסלייק לפוסט של ${ownerName}`,
                nid: staffNid,
                from: uid,
                path: postPath,
            });
            if (staffNotif) Notifications.push(staffNotif, staffUids);
        }

    } catch (err) {
        console.error('[plugin-dislike-notifier] Error:', err);
    }
};

plugin.notifiUnvote = async function (data) {
    const { uid, pid } = data;

    try {
        // מציאת בעל הפוסט (כי הוא לא מגיע ב-data של unvote)
        const owner = await Posts.getPostField(pid, 'uid');
        const staffUids = await getStaffUids();

        // ביטול כל ההתראות הקשורות לפעולה זו
        const nidsToRescind = [
            getNid('voter', uid, pid),      // התראה של הנותן
            getNid('target', owner, pid),   // התראה של המקבל
            getNid('staff', pid, uid)       // התראה של הצוות
        ];

        // פקודת rescind מסירה את ההתראה מהדאטה-בייס ומלוח ההתראות של המשתמש בזמן אמת
        await Promise.all(nidsToRescind.map(nid => Notifications.rescind(nid)));

    } catch (err) {
        console.error('[plugin-dislike-notifier] Error during unvote:', err);
    }
};

module.exports = plugin;