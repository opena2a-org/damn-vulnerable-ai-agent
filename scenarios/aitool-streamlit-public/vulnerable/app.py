import gradio as gr

def predict(text):
    return {"label": "positive", "score": 0.95}

demo = gr.Interface(fn=predict, inputs="text", outputs="json")
demo.launch(share=True, server_name="0.0.0.0", server_port=7860)
