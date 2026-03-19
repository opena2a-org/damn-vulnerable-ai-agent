from fastapi import FastAPI
from langserve import add_routes
from langchain_core.runnables import RunnableLambda

app = FastAPI(title="AI Chain Server")

chain = RunnableLambda(lambda x: f"Processed: {x}")

add_routes(app, chain, path="/chain")
add_routes(app, chain, path="/classify")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
