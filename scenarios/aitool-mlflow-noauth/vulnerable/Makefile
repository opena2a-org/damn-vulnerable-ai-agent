.PHONY: serve

serve:
	mlflow server --host 0.0.0.0 --port 5000 --backend-store-uri sqlite:///mlflow.db

ui:
	mlflow ui --host 0.0.0.0 --port 5001
