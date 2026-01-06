const express = require("express");
const router = express.Router();
const multer = require("multer");
const auth = require("../midlewares/authMiddleware");
const userController = require("../controllers/userController");

// Config Multer (avatar)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 6 * 1024 * 1024, // 6MB
    },
    fileFilter: (_req, file, cb) => {
        const isImage = Boolean(file?.mimetype) && String(file.mimetype).toLowerCase().startsWith("image/");
        if (!isImage) {
            cb(new Error("Format de fichier non supporté"));
            return;
        }
        cb(null, true);
    },
});

// Routes
router.get("/me", auth, userController.getProfile);
router.put("/update", auth, userController.updateProfile);
router.post("/photo", auth, upload.single("photo"), userController.uploadPhoto);
router.get("/photo/:id", userController.getPhoto);
router.put("/credentials", auth, userController.updateCredentials);
router.get("/search", auth, userController.searchUsers);
router.put("/:id/performances", auth, userController.updatePerformances);
router.get("/performance-timeline", auth, userController.getPerformanceTimeline);
router.get("/ffa/performance-timeline", auth, userController.getFfaPerformanceTimeline);
router.get("/ffa/merged-by-event", auth, userController.getFfaMergedByEvent);
router.post("/performance-timeline", auth, userController.addPerformanceTimelinePoint);
router.put("/records", auth, userController.updateRecords);
router.post("/:id/friend-request", auth, userController.sendFriendRequest);
router.post("/:id/friend-request/respond", auth, userController.respondFriendRequest);
router.delete("/:id/friend", auth, userController.removeFriend);

// Notifications (inbox)
router.get("/me/notifications", auth, userController.listMyNotifications);
router.delete("/me/notifications", auth, userController.clearMyNotifications);
router.delete("/me/notifications/:notificationId", auth, userController.deleteMyNotification);

// Push notifications (Expo)
router.post("/me/push-token", auth, userController.registerPushToken);
router.delete("/me/push-token", auth, userController.unregisterPushToken);
router.post("/me/push-test", auth, userController.sendMyTestPush);

router.get("/:id", auth, userController.getUserById);
router.delete("/delete", auth, userController.deleteAccount);

module.exports = router;
