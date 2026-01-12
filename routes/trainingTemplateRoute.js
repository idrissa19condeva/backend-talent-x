const express = require("express");
const auth = require("../midlewares/authMiddleware");
const trainingTemplateController = require("../controllers/trainingTemplateController");
const trainingController = require("../controllers/trainingController");

const router = express.Router();

router.post("/", auth, trainingTemplateController.createTemplate);
router.get("/mine", auth, trainingTemplateController.listMyTemplates);
// Library = my templates + default templates
router.get("/library", auth, trainingTemplateController.listLibraryTemplates);
router.get("/:id", auth, trainingTemplateController.getTemplateById);
router.put("/:id", auth, trainingTemplateController.updateTemplate);
router.delete("/:id", auth, trainingTemplateController.deleteTemplate);

router.post("/:id/duplicate", auth, trainingTemplateController.duplicateTemplate);

// Create a session from a template (snapshot is frozen at creation time)
router.post("/:id/sessions", auth, trainingController.createSessionFromTemplate);

module.exports = router;
