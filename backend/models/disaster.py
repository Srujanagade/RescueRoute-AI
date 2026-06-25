from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel


class Disaster(BaseModel):
    id: str
    type: str
    latitude: float
    longitude: float
    severity: Optional[float] = None
    timestamp: datetime
    source: str
    confidence: Literal["high", "medium", "low"]
    location: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
