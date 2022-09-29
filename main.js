import { Status } from "./status.js";
import { TRIANGULATION } from "./triangulation.js";

const NUM_KEYPOINTS = 468;
const NUM_IRIS_KEYPOINTS = 5;
const GREEN = "#32EEDB";
const RED = "#FF2C35";
const BLUE = "#157AB3";

function isMobile() {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isiOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  return isAndroid || isiOS;
}

function distance(a, b) {
  return Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2));
}

function drawPath(ctx, points, closePath) {
  const region = new Path2D();
  region.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    region.lineTo(point[0], point[1]);
  }

  if (closePath) {
    region.closePath();
  }
  ctx.stroke(region);
}

// global variables
let model,
  ctx,
  videoWidth,
  videoHeight,
  video,
  canvas,
  scatterGLHasInitialized = false,
  scatterGL,
  rafID;

const VIDEO_SIZE = 500;
const mobile = isMobile();

const renderPointCloud = mobile === false;
const status = new Status();
const state = {
  backend: "webgl",
  maxFaces: 1,
  triangulateMesh: true,
  predictIrises: true,
};

if (renderPointCloud) {
  state.renderPointCloud = true;
}

function setupDatGui() {
  const gui = new dat.GUI();
  gui
    .add(state, "backend", ["webgl", "wasm", "cpu"])
    .onChange(async (backend) => {
      window.cancelAnimationFrame(rafID);
      await tf.setBackend(backend);
      requestAnimationFrame(renderPrediction);
    });

  gui.add(state, "maxFaces", 1, 20, 1).onChange(async (val) => {
    model = await faceLandMarksDetection.load(
      faceLandMarksDetection.SupportedPackages.mediaPipeFaceMesh,
      { maxFaces: val }
    );
  });

  gui.add(state, "triangulateMesh");
  gui.add(state, "predictIrises");

  if (renderPointCloud) {
    gui.add(state, "renderPointCloud").onChange((render) => {
      document.querySelector("#scatter-gl-container").style.display = render
        ? "inline-block"
        : "none";
    });
  }
}

async function setupCamera() {
  video = document.querySelector("#video");

  //비디오 촬영 코드
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: "user",
      width: mobile ? undefined : VIDEO_SIZE,
      height: mobile ? undefined : VIDEO_SIZE,
    },
  });
  video.srcObject = stream;

  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      resolve(video);
    };
  });
}

async function renderPrediction() {
  status.begin();

  //The input to estimateFaces can be a video, a static image, or even an ImageData interface for use in node.js pipelines.
  // Facemesh then returns an array of prediction objects for the faces in the input, which include information about each face
  //(e.g. a confidence score, and the locations of 468 landmarks within the face).

  // 로딩된 모델로 얼굴 예측
  const predictions = await model.estimateFaces({
    input: video,
    returnTensors: false,
    flipHorizontal: false,
    predictIrises: state.predictIrises,
  });
  ctx.drawImage(
    video,
    0,
    0,
    videoWidth,
    videoHeight,
    0,
    0,
    canvas.width,
    canvas.height
  );

  if (predictions.length > 0) {
    predictions.forEach((prediction) => {
      //console.log(prediction);
      const keyPoints = prediction.scaledMesh; // 각각의 좌표들의 배열
      //console.log(keyPoints[1][0]);

      // if triangulateMesh is checked !
      if (state.triangulateMesh) {
        ctx.strokeStyle = GREEN;
        ctx.lineWidth = 0.5;

        for (let i = 0; i < TRIANGULATION.length / 3; i++) {
          // console.log(
          //   TRIANGULATION[i * 3],
          //   TRIANGULATION[i * 3 + 1],
          //   TRIANGULATION[i * 3 + 2]
          // );
          const points = [
            TRIANGULATION[i * 3],
            TRIANGULATION[i * 3 + 1],
            TRIANGULATION[i * 3 + 2],
          ].map((index) => keyPoints[index]);

          //console.log(points);

          drawPath(ctx, points, true);
        }
        // if not checking -- arc만 그림
      } else {
        ctx.fillStyle = GREEN;

        for (let i = 0; i < NUM_KEYPOINTS; i++) {
          const x = keyPoints[i][0];
          const y = keyPoints[i][1];

          ctx.beginPath();
          ctx.arc(x, y, 1 /*radius*/, 0, 2 * Math.PI);
          ctx.fill();
        }
      }

      // Iries detection
      if (keyPoints.length > NUM_KEYPOINTS) {
        ctx.strokeStyle = RED;
        ctx.lineWidth = 1;

        const leftCenter = keyPoints[NUM_KEYPOINTS];
        const leftDiameterY = distance(
          keyPoints[NUM_KEYPOINTS + 4],
          keyPoints[NUM_KEYPOINTS + 2]
        );
        console.log(leftDiameterY);
        const leftDiameterX = distance(
          keyPoints[NUM_KEYPOINTS + 3],
          keyPoints[NUM_KEYPOINTS + 1]
        );

        ctx.beginPath();
        ctx.ellipse(
          leftCenter[0],
          leftCenter[1],
          leftDiameterX / 2,
          leftDiameterY / 2,
          0,
          0,
          2 * Math.PI
        );
        ctx.stroke();

        if (keyPoints.length > NUM_KEYPOINTS + NUM_IRIS_KEYPOINTS) {
          const rightCenter = keyPoints[NUM_KEYPOINTS + NUM_IRIS_KEYPOINTS];
          const rightDiameterY = distance(
            keyPoints[NUM_KEYPOINTS + NUM_IRIS_KEYPOINTS + 2],
            keyPoints[NUM_KEYPOINTS + NUM_IRIS_KEYPOINTS + 4]
          );
          const rightDiameterX = distance(
            keyPoints[NUM_KEYPOINTS + NUM_IRIS_KEYPOINTS + 3],
            keyPoints[NUM_KEYPOINTS + NUM_IRIS_KEYPOINTS + 1]
          );

          ctx.beginPath();
          //ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle)
          ctx.ellipse(
            rightCenter[0],
            rightCenter[1],
            rightDiameterX / 2,
            rightDiameterY / 2,
            0,
            0,
            2 * Math.PI
          );
          ctx.stroke();
        }
      }
    });

    if (renderPointCloud && state.renderPointCloud && scatterGL != null) {
      const pointsData = predictions.map((prediction) => {
        let scaledMesh = prediction.scaledMesh;
        return scaledMesh.map((point) => [-point[0], -point[1], -point[2]]);
      });

      let flattenedPointsData = [];
      for (let i = 0; i < pointsData.length; i++) {
        flattenedPointsData = flattenedPointsData.concat(pointsData[i]);
      }
      const dataset = new ScatterGL.Dataset(flattenedPointsData);

      if (!scatterGLHasInitialized) {
        scatterGL.setPointColorer((i) => {
          if (i % (NUM_KEYPOINTS + NUM_IRIS_KEYPOINTS * 2) > NUM_KEYPOINTS) {
            return RED;
          }
          return BLUE;
        });
        scatterGL.render(dataset);
      } else {
        scatterGL.updateDataset(dataset);
      }
      scatterGLHasInitialized = true;
    }
  }

  status.end();

  // 실시간 정보 제공
  rafID = requestAnimationFrame(renderPrediction);
}

async function main() {
  await tf.setBackend(state.backend);
  setupDatGui();

  status.showPanel(0); // 0: fps 1: ms, 2: mb, 3+: custom
  document.querySelector("#main").appendChild(status.dom);

  await setupCamera();
  video.play();
  videoWidth = video.videoWidth;
  videoHeight = video.videoHeight;
  video.width = videoWidth;
  video.height = videoHeight;

  canvas = document.querySelector("#output");
  canvas.width = videoWidth;
  console.log(canvas.width);
  canvas.height = videoHeight;

  const canvasContainer = document.querySelector(".canvas-wrapper");
  canvasContainer.style = `width: ${videoWidth}px; height: ${videoHeight}px`;

  ctx = canvas.getContext("2d");
  // 좌우 반전
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.fillStyle = GREEN;
  ctx.strokeStyle = GREEN;
  ctx.lineWidth = 0.5;

  model = await faceLandmarksDetection.load(
    faceLandmarksDetection.SupportedPackages.mediapipeFacemesh,
    { maxFaces: state.maxFaces }
  );
  renderPrediction();

  if (renderPointCloud) {
    const glContainer = document.querySelector("#scatter-gl-container");
    glContainer.style = `width: ${VIDEO_SIZE}px; height: ${VIDEO_SIZE}px`;

    scatterGL = new ScatterGL(document.querySelector("#scatter-gl-container"), {
      rotateOnStart: false,
      selectEnabled: false,
    });
  }
}

main();
