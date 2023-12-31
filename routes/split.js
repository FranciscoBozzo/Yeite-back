const auth = require("../middleware/auth");
const multerWare = require("../middleware/multer");
const _ = require("lodash");
const express = require("express");
const config = require("config");
const winston = require("winston");
const path = require("path");
const fs = require("fs");
const router = express.Router();
const { findFiles: listFiles, findByName } = require("../utils/fileUtils");
const { Splitjob, validate } = require("../models/Splitjob");
const multer = require("multer");

router.get("/:id", async (req, res) => {
  //Search job by id & userId
  const timestamp = req.params.id;
  try {
    //await findByName(config.get("outputPath"), timestamp);
    const folderPath = path.join(config.get("outputPath"), timestamp);
    const files = await listFiles(folderPath);

    Splitjob.findOne({ timestamp })
      .then((doc) => {
        const fullPaths = files.map((file) => `output/${timestamp}/${file}`);
        doc = doc.toJSON();
        doc.urls = fullPaths;
        res.send(doc);
      })
      .catch((err) => console.error(err));
  } catch (err) {
    res.status(404).send("Job not found");
    console.log("No se encontraron los archivos", err);
  }
});

router.get("/", async (req, res) => {
  //Search all jobs
  const jobs = await Splitjob.find();
  res.send(jobs);
});

router.post("/", async (req, res) => {
  multerWare.single("file")(req, res, async function (err) {
    if (err instanceof multer.MulterError) {
      res.status(500).send("Error de multer");
      console.log("error when uploading", err);
    } else if (err) {
      res.status(500).send("Error desconocido");
      console.log("Unknown error", err);
    }

    //Check validity of request
    const body = { ...req.body, file: req.file };
    console.log("job recibido", body);
    const { error } = validate(body);
    if (error) {
      console.log(error);
      return res.status(400).send(error.details[0].message);
    }
    console.log("job validado...");

    //Generate a job in pending status
    const name = body.name || trimExtension(body.file.originalname);
    const timestamp = trimExtension(body.file.filename);
    const stems = body.stems.toString();

    const document = {
      name,
      timestamp,
      stems,
      status: "pending",
      inputUrl: `/input/${body.file.filename}`,
      outputUrl: `/output/${timestamp}/`,
    };

    const splitjob = new Splitjob(document);
    const job = await splitjob.save();

    //return the job id to client for later use
    res.send(job);
    const filePath = path.join(config.get("inputPath"), body.file.filename);
    const outputPath = config.get("outputPath");
    try {
      //Start spleeter process
      const result = await runPy(
        "splitter.py",
        stems,
        outputPath,
        filePath,
        name
      );

      if (result.toString().toLowerCase().includes("error")) {
        throw new Error("Hubo un error");
      }

      await splitjob.updateOne({
        ...document,
        status: "processed",
      });
    } catch (err) {
      console.log("err", err.toString());
      await splitjob.updateOne({
        ...document,
        status: "failed",
      });
    }
  });
});

function runPy(path, ...args) {
  return new Promise(function (success, nosuccess) {
    const { spawn } = require("child_process");
    const pyprog = spawn("python", [path, ...args]);

    pyprog.stdout.on("data", function (data) {
      success(data);
    });

    pyprog.stderr.on("data", (data) => {
      nosuccess(data);
    });
  });
}

function trimExtension(filename) {
  return filename.replace(/\.[^/.]+$/, "");
}

router.put("/:id", async (req, res) => {});

router.delete("/:id", async (req, res) => {
  console.log(req.params.id);

  const job = await Splitjob.findById(req.params.id);
  if (!job) return res.status(404).send("The genre was not found");
  res.send(job);
  console.log(config.get("outputPath"));
  console.log(config.get("inputPath"));
  return;
  const inputUrl = job.inputUrl;
  const outputUrl = job.outputUrl;

  fs.rm(inputUrl, (err) => console.log(err, "File deleted"));
  fs.rmdir(outputUrl, (err) => console.log(err, "Dir deleted"));

  res.send(job);
});

module.exports = router;
