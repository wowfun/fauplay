import cv2
import onnx
import onnxruntime


class ArcFaceONNX:
    # Borrowed from insightface.model_zoo.arcface_onnx with minimal changes.
    def __init__(self, model_file: str, session: onnxruntime.InferenceSession | None = None):
        self.model_file = model_file
        self.session = session
        find_sub = False
        find_mul = False

        model = onnx.load(self.model_file)
        graph = model.graph
        for node in graph.node[:8]:
            if node.name.startswith("Sub") or node.name.startswith("_minus"):
                find_sub = True
            if node.name.startswith("Mul") or node.name.startswith("_mul"):
                find_mul = True

        if find_sub and find_mul:
            self.input_mean = 0.0
            self.input_std = 1.0
        else:
            self.input_mean = 127.5
            self.input_std = 127.5

        if self.session is None:
            self.session = onnxruntime.InferenceSession(self.model_file, None)

        input_cfg = self.session.get_inputs()[0]
        self.input_size = tuple(input_cfg.shape[2:4][::-1])
        self.input_name = input_cfg.name

        outputs = self.session.get_outputs()
        self.output_names = [out.name for out in outputs]
        if len(self.output_names) != 1:
            raise RuntimeError("ArcFace model must expose exactly one output")

    def get_feat(self, images):
        if not isinstance(images, list):
            images = [images]
        blob = cv2.dnn.blobFromImages(
            images,
            1.0 / self.input_std,
            self.input_size,
            (self.input_mean, self.input_mean, self.input_mean),
            swapRB=True,
        )
        return self.session.run(self.output_names, {self.input_name: blob})[0]
