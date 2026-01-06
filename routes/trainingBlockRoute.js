const express = require("express");
const auth = require("../midlewares/authMiddleware");
const trainingBlockController = require("../controllers/trainingBlockController");

const router = express.Router();

router.post("/", auth, trainingBlockController.createBlock);
router.get("/mine", auth, trainingBlockController.listMyBlocks);
router.get("/:id", auth, trainingBlockController.getBlockById);
router.put("/:id", auth, trainingBlockController.updateBlock);
router.delete("/:id", auth, trainingBlockController.deleteBlock);

module.exports = router;
