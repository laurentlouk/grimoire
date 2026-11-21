from fastapi import APIRouter

router = APIRouter()


@router.get("/")
def read_items():
    return []


@router.post("/")
def create_item():
    return {}
