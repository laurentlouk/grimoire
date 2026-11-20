from fastapi import APIRouter, Depends

from app.api.deps import get_current_user

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me")
def read_user_me():
    return {"name": "me"}


@router.patch("/me", dependencies=[Depends(get_current_user)])
def update_user_me():
    return {}


@router.get("/{user_id}")
def read_user_by_id(user_id: int):
    return {"id": user_id}
