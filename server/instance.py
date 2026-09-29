from asyncio import Event, Lock
from typing import List

from PIL import Image
from pydantic import BaseModel

from manga_translator import Config
from server.sent_data_internal import fetch_data_stream, NotifyType, fetch_data

class ExecutorInstance(BaseModel):
    ip: str
    port: int
    busy: bool = False
    nonce: str | None = None

    def request_headers(self) -> dict[str, str]:
        return {"X-Nonce": self.nonce} if self.nonce else {}

    def free_executor(self):
        self.busy = False

    async def sent(self, image: Image, config: Config):
        return await fetch_data(
            "http://" + self.ip + ":" + str(self.port) + "/simple_execute/translate",
            image,
            config,
            headers=self.request_headers(),
        )

    async def sent_stream(self, image: Image, config: Config, sender: NotifyType):
        await fetch_data_stream(
            "http://" + self.ip + ":" + str(self.port) + "/execute/translate",
            image,
            config,
            sender,
            headers=self.request_headers(),
        )

    async def sent_batch(self, images: List[Image.Image], config: Config, batch_size: int):
        """发送批量翻译请求"""
        return await fetch_data(
            "http://" + self.ip + ":" + str(self.port) + "/simple_execute/translate_batch",
            {"images": images, "config": config, "batch_size": batch_size},
            headers=self.request_headers(),
        )

    async def sent_batch_stream(self, images: List[Image.Image], config: Config, batch_size: int, sender: NotifyType):
        """发送批量翻译流式请求"""
        await fetch_data_stream(
            "http://" + self.ip + ":" + str(self.port) + "/execute/translate_batch",
            {"images": images, "config": config, "batch_size": batch_size},
            config,
            sender,
            headers=self.request_headers(),
        )

class Executors:
    def __init__(self):
        self.list: List[ExecutorInstance] = []
        self.lock: Lock = Lock()
        self.event = Event()

    def register(self, instance: ExecutorInstance):
        # The embedded translator registers itself after the parent process
        # has already reserved its endpoint. Keep one executor per endpoint.
        existing = next(
            (item for item in self.list if item.ip == instance.ip and item.port == instance.port),
            None,
        )
        if existing is None:
            self.list.append(instance)
        else:
            existing.nonce = instance.nonce
            existing.busy = instance.busy

    def free_executors(self) -> int:
        return len([item for item in self.list if not item.busy])

    async def _find_instance(self):
        while True:
            instance = next((x for x in self.list if x.busy == False), None)
            if instance is not None:
                return instance
            #todo: cricial error: warn should never happen
            await self.event.wait()

    async def find_executor(self) -> ExecutorInstance:
        async with self.lock:  # Using async with for lock management
            instance = await self._find_instance()
            instance.busy = True
            return instance

    async def free_executor(self, instance: ExecutorInstance):
        from server.myqueue import task_queue
        instance.free_executor()
        self.event.set()
        self.event.clear()
        await task_queue.update_event()

executor_instances: Executors = Executors()
