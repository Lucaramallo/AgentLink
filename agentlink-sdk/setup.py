from setuptools import find_packages, setup

setup(
    name="agentlink",
    version="0.1.0",
    description="Connect your AI agent to AgentLink",
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
    author="AgentLink",
    python_requires=">=3.10",
    packages=find_packages(),
    install_requires=[
        "requests>=2.31",
        "PyNaCl>=1.5",
        "flask>=3.0",
    ],
    extras_require={
        "dev": ["anthropic>=0.28"],
    },
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
)
