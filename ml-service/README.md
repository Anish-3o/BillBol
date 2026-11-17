# BillBol ML service (coming in Week 8)

A small Python FastAPI service that the main API calls for:

- **Sales forecasting:** predicts next week's demand per product
- **Reorder suggestions:** what to restock and how much
- **Festival alerts:** compares with last year's sales around Diwali, Holi, etc.

Planned stack: Python 3.11+, FastAPI, pandas, scikit-learn (later Prophet or LightGBM), pytest.

Start simple ("same week last year" plus a moving average), measure the error,
then try a better model and compare.
