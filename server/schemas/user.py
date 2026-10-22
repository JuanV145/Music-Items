from pydantic import BaseModel, EmailStr
from typing import Optional


class UserBase(BaseModel):
    username: str
    email: EmailStr


class UserCreate(UserBase):
    password: str  # In practice, we should not return the password in the response


class UserResponse(UserBase):
    id: int
    is_active: bool

    class Config:
        from_attributes = True