import gradio as gr

def classify(text):
    return {"positive": 0.8, "negative": 0.2}

demo = gr.Interface(fn=classify, inputs="text", outputs="label")
demo.launch(share=True, server_name="0.0.0.0")
