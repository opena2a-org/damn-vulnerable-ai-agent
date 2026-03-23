"""Load a pre-trained model from a shared repository."""
import pickle
import os

MODEL_PATH = os.environ.get("MODEL_PATH", "model.pkl")


def load_model(path=MODEL_PATH):
    """Load model from pickle file.

    VULNERABLE: pickle.load() executes arbitrary code during
    deserialization. An attacker who controls the .pkl file
    can achieve remote code execution.
    """
    with open(path, "rb") as f:
        model = pickle.load(f)  # nosec -- intentionally vulnerable
    return model


def predict(input_data):
    model = load_model()
    return model.predict(input_data)


if __name__ == "__main__":
    model = load_model()
    print(f"Model loaded: {type(model).__name__}")
