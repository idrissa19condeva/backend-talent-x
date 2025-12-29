const express = require("express");
const router = express.Router();
const multer = require("multer");
const auth = require("../midlewares/authMiddleware");
const userController = require("../controllers/userController");

// Config Multer
const storage = multer.diskStorage({
    destination: "./uploads/",
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    },
});
const upload = multer({ storage });

// Routes
router.get("/me", auth, userController.getProfile);
router.put("/update", auth, userController.updateProfile);
router.post("/photo", auth, upload.single("photo"), userController.uploadPhoto);
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
router.get("/:id", auth, userController.getUserById);
router.delete("/delete", auth, userController.deleteAccount);

module.exports = router;
